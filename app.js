        import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
        import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
        import { getFirestore, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

        // Firebase Configuration
        const firebaseConfig = {
            apiKey: "AIzaSyCLVITDz6EkpSNS1XMuIvRaKEmDNN_h_Eg",
            authDomain: "life-gamification-app-b7674.firebaseapp.com",
            projectId: "life-gamification-app-b7674",
            storageBucket: "life-gamification-app-b7674.firebasestorage.app",
            messagingSenderId: "204483721645",
            appId: "1:204483721645:web:43192b9596feffbd888924"
        };

        // Initialize Firebase
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);

        // Global state
        window.currentUser = null;
        window.userData = null;
        window.currentTab = 'activities';

        // ── Life Categories (for spider chart & share card) ───────────────
        window.LIFE_CATEGORIES = [
            { id: 'body',   label: 'Body',   emoji: '⚡', color: '#e05c3a', desc: 'Health, fitness, nutrition, sleep' },
            { id: 'mind',   label: 'Mind',   emoji: '🧠', color: '#5a7fd4', desc: 'Learning, focus, mental health, growth' },
            { id: 'people', label: 'People', emoji: '🤝', color: '#d45a9f', desc: 'Relationships, social, community' },
            { id: 'work',   label: 'Work',   emoji: '🔨', color: '#d4a03a', desc: 'Career, finances, projects, skills' },
            { id: 'extra',  label: 'Extra',  emoji: '✦',  color: '#6b9e5e', desc: 'Hobbies, creativity, play, misc' },
        ];

        // Aggregate dimension XP by life category
        function getCategoryXP() {
            const map = {};
            window.LIFE_CATEGORIES.forEach(c => { map[c.id] = 0; });
            (window.userData.dimensions || []).forEach(dim => {
                const cat = dim.lifeCategory;
                if (cat && map.hasOwnProperty(cat)) map[cat] += (dim.dimTotalXP || 0);
            });
            return map;
        }

        // Character title based on dominant category and level
        function getCharacterTitle(level, categoryXP) {
            const entries = Object.entries(categoryXP).filter(([, xp]) => xp > 0);
            if (entries.length > 0) {
                entries.sort((a, b) => b[1] - a[1]);
                const total = entries.reduce((s, [, v]) => s + v, 0);
                const share = entries[0][1] / total;
                if (share > 0.5) {
                    const titles = {
                        body:   ['The Athlete', 'The Warrior', 'The Iron Will'],
                        mind:   ['The Scholar', 'The Sage', 'The Polymath'],
                        people: ['The Connector', 'The Empath', 'The Community Builder'],
                        work:   ['The Craftsperson', 'The Builder', 'The Architect'],
                        extra:  ['The Explorer', 'The Free Spirit', 'The Renaissance Soul'],
                    };
                    const opts = titles[entries[0][0]] || ['The Adventurer'];
                    return opts[Math.min(Math.floor(level / 33), opts.length - 1)];
                }
                if (entries.length >= 3 && share < 0.35) return level >= 50 ? 'The Polymath' : 'The Well-Rounded';
            }
            if (level >= 90) return 'The Legend';
            if (level >= 70) return 'The Master';
            if (level >= 50) return 'The Adept';
            if (level >= 30) return 'The Journeyman';
            if (level >= 15) return 'The Apprentice';
            return 'The Initiate';
        }

        // Top activities since levelStartedAt
        function getTopActivitiesThisLevel() {
            const levelStart = window.userData.levelStartedAt ? new Date(window.userData.levelStartedAt) : null;
            const actXP = [];
            (window.userData.dimensions || []).forEach(dim => {
                (dim.paths || []).forEach(path => {
                    (path.activities || []).forEach(act => {
                        let xp = 0;
                        (act.completionHistory || []).forEach(e => {
                            if (e.isPenalty) return;
                            if (levelStart && new Date(e.date) < levelStart) return;
                            xp += Math.abs(e.xp || 0);
                        });
                        if (xp > 0) actXP.push({ name: act.name, xp, streak: act.streak || 0 });
                    });
                });
            });
            return actXP.sort((a, b) => b.xp - a.xp).slice(0, 3);
        }

        function getDaysSinceLastLevel() {
            if (!window.userData.levelStartedAt) return null;
            const diff = Date.now() - new Date(window.userData.levelStartedAt).getTime();
            const days = diff / (1000 * 60 * 60 * 24);
            if (days < 1) return `${Math.round(days * 24)}h`;
            return `${days.toFixed(1)}d`;
        }

        function getTop2Categories(categoryXP) {
            return Object.entries(categoryXP)
                .filter(([, xp]) => xp > 0)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 2)
                .map(([id, xp]) => ({ ...window.LIFE_CATEGORIES.find(c => c.id === id), xp }));
        }

        function getBestActiveStreak() {
            let best = null;
            (window.userData.dimensions || []).forEach(dim => {
                (dim.paths || []).forEach(path => {
                    (path.activities || []).forEach(act => {
                        if ((act.streak || 0) > (best ? best.streak : 0)) best = { name: act.name, streak: act.streak };
                    });
                });
            });
            return best;
        }

        // Hex → "r,g,b" string for canvas rgba()
        function _hexToRgbStr(hex) {
            hex = (hex || '#4a7c9e').trim().replace('#', '');
            if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
            const n = parseInt(hex, 16);
            return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
        }

        // ── Level-Up Share Card renderer (1080×1920 canvas → PNG blob) ────
        async function buildLevelUpCard(newLevel) {
            const W = 1080, H = 1920;
            const canvas = document.createElement('canvas');
            canvas.width = W; canvas.height = H;
            const ctx = canvas.getContext('2d');

            const prevLevel = newLevel - 1;
            const root = getComputedStyle(document.documentElement);
            const uAccent   = root.getPropertyValue('--color-accent-blue').trim()  || '#4a7c9e';
            const uProgress = root.getPropertyValue('--color-progress').trim()      || '#5a9fd4';
            const uRed      = root.getPropertyValue('--color-accent-red').trim()    || '#8e3b5f';
            const uOlive    = root.getPropertyValue('--color-accent-olive').trim()  || '#7a7b4d';
            const uGreen    = root.getPropertyValue('--color-accent-green').trim()  || '#6b7c3f';

            // ── Background ──
            ctx.fillStyle = '#0e0e12'; ctx.fillRect(0, 0, W, H);

            // Glow blobs
            function glow(x, y, r, hex, alpha) {
                ctx.save(); ctx.globalAlpha = alpha;
                const g = ctx.createRadialGradient(x, y, 0, x, y, r);
                g.addColorStop(0, hex); g.addColorStop(1, 'transparent');
                ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
            }
            glow(180,  380, 680, uAccent,   0.2);
            glow(920, 1540, 740, uRed,      0.15);
            glow(540,  940, 480, uProgress, 0.11);

            // Subtle grain
            ctx.save(); ctx.globalAlpha = 0.022;
            for (let i = 0; i < 7000; i++) {
                ctx.fillStyle = Math.random() > 0.5 ? '#fff' : '#000';
                ctx.fillRect(Math.random() * W, Math.random() * H, 1, 1);
            }
            ctx.restore();

            // Diagonal rule lines
            ctx.save(); ctx.strokeStyle = uAccent; ctx.globalAlpha = 0.07; ctx.lineWidth = 1;
            for (let i = -H; i < W + H; i += 130) {
                ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + H, H); ctx.stroke();
            }
            ctx.restore();

            function roundRect(x, y, w, h, r) {
                ctx.beginPath();
                ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
                ctx.quadraticCurveTo(x + w, y, x + w, y + r);
                ctx.lineTo(x + w, y + h - r);
                ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
                ctx.lineTo(x + r, y + h);
                ctx.quadraticCurveTo(x, y + h, x, y + h - r);
                ctx.lineTo(x, y + r);
                ctx.quadraticCurveTo(x, y, x + r, y);
                ctx.closePath();
            }

            const PAD = 64;

            // ── Brand header — matches auth screen style ──
            // Brand icon circle (matching .auth-brand-icon feel)
            const brandIconY = 150;
            ctx.save();
            const iconGrad = ctx.createRadialGradient(W/2, brandIconY, 0, W/2, brandIconY, 90);
            iconGrad.addColorStop(0, `rgba(${_hexToRgbStr(uProgress)}, 0.18)`);
            iconGrad.addColorStop(1, `rgba(${_hexToRgbStr(uAccent)}, 0.06)`);
            ctx.beginPath(); ctx.arc(W/2, brandIconY, 80, 0, Math.PI * 2);
            ctx.fillStyle = iconGrad; ctx.fill();
            ctx.strokeStyle = uAccent; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.restore();
            // Brain emoji
            ctx.font = '96px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('🧠', W/2, brandIconY);
            ctx.textBaseline = 'alphabetic';

            // Brand name — gradient text matching login screen
            ctx.font = '800 72px system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'center';
            const brandGrad = ctx.createLinearGradient(W/2 - 240, 0, W/2 + 240, 0);
            brandGrad.addColorStop(0, '#ffffff');
            brandGrad.addColorStop(1, uProgress);
            ctx.fillStyle = brandGrad;
            ctx.fillText('Mindkraft', W/2, 290);

            // Tagline — matching .auth-brand-tagline style
            ctx.font = '400 34px system-ui, -apple-system, sans-serif';
            ctx.fillStyle = 'rgba(176,176,176,0.75)';
            ctx.fillText('Strengthen your mind. Gamify your life.', W/2, 348);

            // Separator line
            ctx.save();
            const sepGrad = ctx.createLinearGradient(PAD, 380, W - PAD, 380);
            sepGrad.addColorStop(0, 'transparent'); sepGrad.addColorStop(0.35, uAccent);
            sepGrad.addColorStop(0.65, uProgress);  sepGrad.addColorStop(1, 'transparent');
            ctx.strokeStyle = sepGrad; ctx.globalAlpha = 0.45; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(PAD, 380); ctx.lineTo(W - PAD, 380); ctx.stroke();
            ctx.restore();

            // ── "LEVEL UP" pill label ──
            const pillY = 450;
            ctx.save();
            roundRect(W/2 - 180, pillY - 46, 360, 72, 36);
            ctx.fillStyle = `rgba(${_hexToRgbStr(uAccent)}, 0.15)`; ctx.fill();
            ctx.strokeStyle = uAccent; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.restore();
            ctx.font = '700 40px system-ui, sans-serif'; ctx.fillStyle = uProgress; ctx.textAlign = 'center';
            ctx.letterSpacing = '0.12em';
            ctx.fillText('LEVEL UP', W/2, pillY);
            ctx.letterSpacing = '0';

            // ── HERO: Level number ──
            const heroY = 770;
            // Outer orbit ring
            ctx.save(); ctx.strokeStyle = uAccent; ctx.globalAlpha = 0.2; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(W/2, heroY, 295, 0, Math.PI * 2); ctx.stroke();
            // Inner progress arc
            ctx.strokeStyle = uProgress; ctx.globalAlpha = 0.55; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(W/2, heroY, 272, -Math.PI/2, Math.PI * 1.15); ctx.stroke();
            ctx.restore();

            // Level number with gradient
            const fontSize = newLevel >= 100 ? 270 : 320;
            ctx.font = `800 ${fontSize}px system-ui, -apple-system, sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const numGrad = ctx.createLinearGradient(W/2 - 220, heroY - 170, W/2 + 220, heroY + 170);
            numGrad.addColorStop(0, '#ffffff');
            numGrad.addColorStop(0.45, uProgress);
            numGrad.addColorStop(1, uAccent);
            ctx.fillStyle = numGrad;
            ctx.fillText(String(newLevel), W/2, heroY);
            ctx.textBaseline = 'alphabetic';

            // Transition label
            ctx.font = '500 50px system-ui, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.38)'; ctx.textAlign = 'center';
            ctx.fillText(`L${prevLevel}  →  L${newLevel}`, W/2, heroY + 330);

            // ── Character title pill ──
            const catXP = getCategoryXP();
            const charTitle = getCharacterTitle(newLevel, catXP);
            const ctY = heroY + 430;
            ctx.save();
            const ctW = Math.min(ctx.measureText(charTitle).width + 120, 600);
            roundRect(W/2 - ctW/2, ctY - 54, ctW, 76, 38);
            ctx.fillStyle = `rgba(${_hexToRgbStr(uProgress)}, 0.12)`; ctx.fill();
            ctx.strokeStyle = uProgress; ctx.globalAlpha = 0.4; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.restore();
            ctx.font = '600 40px system-ui, sans-serif'; ctx.fillStyle = uProgress; ctx.textAlign = 'center';
            ctx.fillText(charTitle, W/2, ctY);

            // ── Divider ──
            const div1Y = ctY + 90;
            ctx.save();
            const dg = ctx.createLinearGradient(PAD, div1Y, W - PAD, div1Y);
            dg.addColorStop(0, 'transparent'); dg.addColorStop(0.3, uAccent);
            dg.addColorStop(0.7, uProgress);   dg.addColorStop(1, 'transparent');
            ctx.strokeStyle = dg; ctx.globalAlpha = 0.4; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(PAD, div1Y); ctx.lineTo(W - PAD, div1Y); ctx.stroke();
            ctx.restore();

            // ── Stat cards row ──
            const sTop = div1Y + 55;
            const sW = (W - PAD * 2 - 28) / 2;
            const sH = 196;

            function statCard(x, y, w, h, label, val, sub, ac) {
                ctx.save(); roundRect(x, y, w, h, 22);
                ctx.fillStyle = 'rgba(255,255,255,0.045)'; ctx.fill();
                ctx.strokeStyle = ac || uAccent; ctx.globalAlpha = 0.22; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
                ctx.font = '500 28px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.4)';
                ctx.textAlign = 'center'; ctx.fillText(label.toUpperCase(), x + w/2, y + 48);
                ctx.font = `700 ${val.length > 8 ? 46 : 58}px system-ui, sans-serif`; ctx.fillStyle = ac || uProgress;
                ctx.fillText(val, x + w/2, y + 120);
                if (sub) { ctx.font = '400 26px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillText(sub, x + w/2, y + 162); }
            }

            // XP this level
            const levelStart = window.userData.levelStartedAt ? new Date(window.userData.levelStartedAt) : null;
            let xpThisLevel = 0;
            (window.userData.dimensions || []).forEach(dim => {
                (dim.paths || []).forEach(path => {
                    (path.activities || []).forEach(act => {
                        (act.completionHistory || []).forEach(e => {
                            if (e.isPenalty) return;
                            if (levelStart && new Date(e.date) < levelStart) return;
                            xpThisLevel += Math.abs(e.xp || 0);
                        });
                    });
                });
            });
            if (!xpThisLevel) xpThisLevel = window.userData.totalXP || 0;

            statCard(PAD, sTop, sW, sH, 'XP This Level', xpThisLevel.toLocaleString(), getDaysSinceLastLevel() || '—', uProgress);
            statCard(PAD + sW + 28, sTop, sW, sH, 'Total XP', (window.userData.totalXP || 0).toLocaleString(), 'all time', uAccent);

            // ── Top activities ──
            const topActs = getTopActivitiesThisLevel();
            const aSecY = sTop + sH + 44;

            ctx.font = '500 28px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.textAlign = 'left'; ctx.fillText('TOP ACTIVITIES THIS LEVEL', PAD, aSecY);

            let actBlockBottom = aSecY + 20;

            if (topActs.length > 0) {
                const priH = 158;
                const priY = aSecY + 18;
                ctx.save(); roundRect(PAD, priY, W - PAD * 2, priH, 20);
                const ag = ctx.createLinearGradient(PAD, priY, W - PAD, priY);
                ag.addColorStop(0, `rgba(${_hexToRgbStr(uAccent)},0.16)`);
                ag.addColorStop(1, `rgba(${_hexToRgbStr(uProgress)},0.07)`);
                ctx.fillStyle = ag; ctx.fill();
                ctx.strokeStyle = uAccent; ctx.globalAlpha = 0.28; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();

                // Name
                ctx.font = '600 44px system-ui, sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
                let pName = topActs[0].name;
                const maxNW = W - PAD * 2 - 260;
                while (ctx.measureText(pName).width > maxNW && pName.length > 3) pName = pName.slice(0, -2) + '…';
                ctx.fillText(pName, PAD + 34, priY + 68);

                // XP badge
                ctx.save(); roundRect(W - PAD - 210, priY + 28, 210, 54, 12);
                ctx.fillStyle = `rgba(${_hexToRgbStr(uProgress)},0.18)`; ctx.fill(); ctx.restore();
                ctx.font = '700 34px system-ui, sans-serif'; ctx.fillStyle = uProgress; ctx.textAlign = 'center';
                ctx.fillText(`+${topActs[0].xp.toLocaleString()} XP`, W - PAD - 105, priY + 66);

                // Streak
                if (topActs[0].streak > 0) {
                    ctx.font = '500 30px system-ui, sans-serif'; ctx.fillStyle = uOlive; ctx.textAlign = 'left';
                    ctx.fillText(`🔥 ${topActs[0].streak} day streak`, PAD + 34, priY + 124);
                }

                actBlockBottom = priY + priH + 18;

                // Secondary chips
                if (topActs.length > 1) {
                    const chipH = 66;
                    let chipX = PAD;
                    for (let ci = 1; ci < Math.min(topActs.length, 3); ci++) {
                        const act = topActs[ci];
                        ctx.font = '400 26px system-ui, sans-serif';
                        const cNW = ctx.measureText(act.name).width;
                        const cXW = ctx.measureText(` · ${act.xp.toLocaleString()} XP`).width;
                        const chipW = Math.min(cNW + cXW + 50, (W - PAD * 2 - 18) / 2);
                        ctx.save(); roundRect(chipX, actBlockBottom, chipW, chipH, 14);
                        ctx.fillStyle = 'rgba(255,255,255,0.055)'; ctx.fill();
                        ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
                        // Truncate
                        let cN = act.name;
                        while (ctx.measureText(cN).width > chipW - 60 && cN.length > 3) cN = cN.slice(0, -2) + '…';
                        ctx.font = '400 26px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.textAlign = 'left';
                        ctx.fillText(cN, chipX + 18, actBlockBottom + 42);
                        ctx.fillStyle = uProgress;
                        ctx.fillText(` · ${act.xp.toLocaleString()}`, chipX + 18 + ctx.measureText(cN).width, actBlockBottom + 42);
                        chipX += chipW + 16;
                        if (chipX + 200 > W - PAD) break;
                    }
                    actBlockBottom += chipH + 18;
                }
            } else {
                ctx.font = '400 30px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.textAlign = 'left';
                ctx.fillText('Complete activities to see your top performers here.', PAD, aSecY + 70);
                actBlockBottom = aSecY + 90;
            }

            // ── Top 2 categories ──
            const top2 = getTop2Categories(catXP);
            if (top2.length > 0) {
                const catSecY = actBlockBottom + 40;
                ctx.font = '500 28px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.35)';
                ctx.textAlign = 'left'; ctx.fillText('MOST ACTIVE AREAS', PAD, catSecY);
                const catW = (W - PAD * 2 - 28) / 2;
                const catH = 158;
                top2.forEach((cat, i) => {
                    const cx = PAD + i * (catW + 28), cy = catSecY + 18;
                    ctx.save(); roundRect(cx, cy, catW, catH, 20);
                    ctx.fillStyle = `rgba(${_hexToRgbStr(cat.color)},0.1)`; ctx.fill();
                    ctx.strokeStyle = cat.color; ctx.globalAlpha = 0.32; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
                    ctx.font = '500 58px system-ui, sans-serif'; ctx.textAlign = 'left';
                    ctx.fillText(cat.emoji, cx + 22, cy + 78);
                    ctx.font = '600 36px system-ui, sans-serif'; ctx.fillStyle = cat.color;
                    ctx.fillText(cat.label, cx + 96, cy + 70);
                    ctx.font = '400 26px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.4)';
                    ctx.fillText(`${cat.xp.toLocaleString()} XP`, cx + 96, cy + 114);
                });
            }

            // ── Best streak banner ──
            const bestStreak = getBestActiveStreak();
            const strY = H - 290;
            if (bestStreak && bestStreak.streak >= 3) {
                ctx.save(); roundRect(PAD, strY, W - PAD * 2, 118, 20);
                const sg = ctx.createLinearGradient(PAD, strY, W - PAD, strY);
                sg.addColorStop(0, `rgba(${_hexToRgbStr(uOlive)},0.14)`);
                sg.addColorStop(1, `rgba(${_hexToRgbStr(uGreen)},0.07)`);
                ctx.fillStyle = sg; ctx.fill();
                ctx.strokeStyle = uOlive; ctx.globalAlpha = 0.28; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
                ctx.font = '500 28px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.textAlign = 'left';
                ctx.fillText('BEST ACTIVE STREAK', PAD + 34, strY + 44);
                ctx.font = '700 42px system-ui, sans-serif'; ctx.fillStyle = uOlive;
                ctx.fillText(`🔥 ${bestStreak.streak} days`, PAD + 34, strY + 96);
                ctx.font = '400 28px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.textAlign = 'right';
                let sn = bestStreak.name;
                while (ctx.measureText(sn).width > 380 && sn.length > 3) sn = sn.slice(0, -2) + '…';
                ctx.fillText(sn, W - PAD - 34, strY + 76);
            }

            // ── Footer ──
            ctx.save();
            const fGrad = ctx.createLinearGradient(PAD, H - 112, W - PAD, H - 112);
            fGrad.addColorStop(0, 'transparent'); fGrad.addColorStop(0.35, uAccent);
            fGrad.addColorStop(0.65, uProgress);  fGrad.addColorStop(1, 'transparent');
            ctx.strokeStyle = fGrad; ctx.globalAlpha = 0.3; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(PAD, H - 112); ctx.lineTo(W - PAD, H - 112); ctx.stroke(); ctx.restore();
            ctx.font = '400 28px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.textAlign = 'center';
            ctx.fillText('mindkraft.app', W/2, H - 68);

            return new Promise(resolve => canvas.toBlob(resolve, 'image/png', 0.95));
        }

        // ── Share level-up card via Web Share API (with download fallback) ─
        window.shareLevelUpCard = async function(level) {
            const btn = document.getElementById('shareLevelUpBtn');
            if (btn) { btn.disabled = true; btn.textContent = 'Building card…'; }
            try {
                const blob = await buildLevelUpCard(level);
                const file = new File([blob], `mindkraft-level-${level}.png`, { type: 'image/png' });
                if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: `I just hit Level ${level} on Mindkraft!`,
                        text: `Leveled up to ${level} on Mindkraft — gamify your life 🎮`,
                    });
                    showToast('Shared! 🎉', 'olive');
                } else {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = `mindkraft-level-${level}.png`; a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                    showToast('Card saved — share it anywhere! 🎉', 'blue');
                }
            } catch (err) {
                if (err.name !== 'AbortError') { console.error('Share failed:', err); showToast('Could not share — try again', 'red'); }
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = '🚀 Share Progress'; }
            }
        };

        // Auth State Listener with timeout fallback
        let authCheckTimeout = setTimeout(() => {
            console.error('Auth initialization timeout - showing login screen');
            document.getElementById('loading').style.display = 'none';
            document.getElementById('authContainer').style.display = 'flex';
        }, 5000); // 5 second timeout

        onAuthStateChanged(auth, async (user) => {
            clearTimeout(authCheckTimeout);
            
            const loading = document.getElementById('loading');
            const authContainer = document.getElementById('authContainer');
            const appContainer = document.getElementById('appContainer');

            try {
                if (user) {
                    // Show a lightweight "Loading your data…" in the spinner while Firestore loads
                    window.currentUser = user;
                    await loadUserData(user.uid);
                    
                    loading.style.display = 'none';
                    authContainer.style.display = 'none';
                    appContainer.classList.add('active');
                    
                    const userEmailEl = document.getElementById('userEmail');
                    if (userEmailEl) userEmailEl.textContent = user.email;
                    const settingsEmailEl = document.getElementById('settingsEmail');
                    if (settingsEmailEl) settingsEmailEl.textContent = user.email;
                    loadSettings();
                    processStreakPauses();
                    scheduleReminder();
                    updateDashboard();
                    // Init the restore backup button visibility (async — non-blocking)
                    updateRestoreBackupBtn().catch(e => {});
                } else {
                    window.currentUser = null;
                    window.userData = null;
                    loading.style.display = 'none';
                    authContainer.style.display = 'flex';
                    appContainer.classList.remove('active');
                }
            } catch (error) {
                console.error('Auth state error:', error);
                loading.style.display = 'none';
                authContainer.style.display = 'flex';
                appContainer.classList.remove('active');
                showError('Failed to load. Please refresh and try again.');
            }
        });

        // Load User Data
        async function loadUserData(uid) {
            try {
                const userDocRef = doc(db, 'users', uid);
                const userDoc = await getDoc(userDocRef);

                if (userDoc.exists()) {
                    window.userData = userDoc.data();
                } else {
                    // Initialize new user data
                    window.userData = {
                        level: 1,
                        currentXP: 0,
                        totalXP: 0,
                        dimensions: [],
                        activities: [],
                        challenges: [],
                        rewards: {},
                        createdAt: new Date().toISOString()
                    };
                    await setDoc(userDocRef, window.userData);
                }
                console.log('User data loaded successfully');
            } catch (error) {
                console.error('Error loading user data:', error);
                // Initialize with default data if Firestore fails
                window.userData = {
                    level: 1,
                    currentXP: 0,
                    totalXP: 0,
                    dimensions: [],
                    activities: [],
                    challenges: [],
                    createdAt: new Date().toISOString()
                };
                throw error;
            }
        }

        // Update Dashboard
        function updateDashboard() {
            const data = window.userData;
            const level = Math.min(data.level || 1, 100); // enforce cap
            data.level = level;
            const currentXP = data.currentXP || 0;
            const isMaxLevel = level >= 100;
            const nextLevelXP = isMaxLevel ? 0 : calculateXPForLevel(level);
            const progress = isMaxLevel ? 100 : (currentXP / nextLevelXP) * 100;

            const prevLevel = parseInt(document.getElementById('currentLevel').textContent) || 0;
            document.getElementById('currentLevel').textContent = level;
            if (level !== prevLevel && prevLevel !== 0) {
                const el = document.getElementById('currentLevel');
                el.classList.remove('level-pop');
                void el.offsetWidth; // force reflow to restart animation
                el.classList.add('level-pop');
                el.addEventListener('animationend', () => el.classList.remove('level-pop'), { once: true });
            }
            animateCounter('currentXP', isMaxLevel ? null : currentXP, isMaxLevel ? 'MAX' : null);
            document.getElementById('progressBar').style.width = Math.min(progress, 100) + '%';
            const progressPctEl = document.getElementById('progressPercent');
            if (progressPctEl) progressPctEl.textContent = isMaxLevel ? '100%' : Math.floor(progress) + '%';

            // Above-bar right: XP to next (in green)
            const xpToNextDisp = document.getElementById('xpToNextDisplay');
            if (xpToNextDisp) {
                if (isMaxLevel) {
                    xpToNextDisp.textContent = 'Max!';
                } else {
                    const xpNeeded = Math.max(0, nextLevelXP - currentXP);
                    xpToNextDisp.textContent = xpNeeded;
                }
            }

            const today = new Date().toDateString();
            const todayKey = new Date().toISOString().slice(0, 10);
            let completedToday = 0;
            let xpToday = 0;
            let longestStreak = 0;

            // Prune ghost entries older than today (keeps userData tidy)
            if (data.xpTodayGhost) {
                Object.keys(data.xpTodayGhost).forEach(k => { if (k < todayKey) delete data.xpTodayGhost[k]; });
            }

            (data.dimensions || []).forEach(dim => {
                (dim.paths || []).forEach(path => {
                    (path.activities || []).forEach(activity => {
                        // "Done today" = count of user-initiated clicks since midnight.
                        // Auto-penalties (isPenalty: true) are excluded.
                        // Undos remove history entries so the count naturally decreases.
                        if (activity.completionHistory) {
                            activity.completionHistory.forEach(e => {
                                if (e.date && new Date(e.date).toDateString() === today) {
                                    if (!e.isPenalty) completedToday++;
                                    xpToday += (e.xp || 0);
                                }
                            });
                        }
                        // Track longest (all-time best) streak
                        const best = activity.bestStreak || activity.streak || 0;
                        if (best > longestStreak) longestStreak = best;
                    });
                });
            });

            // Add XP from activities deleted today so the stat isn't artificially deflated
            xpToday += (data.xpTodayGhost || {})[todayKey] || 0;

            document.getElementById('xpToday').textContent = xpToday;
            document.getElementById('completedToday').textContent = completedToday;
            document.getElementById('longestStreak').textContent = longestStreak;

            // Activity slot counter
            const { total: actTotal, limit: actLimit } = getActivityCounts();
            const slotEl = document.getElementById('activitySlotCount');
            if (slotEl) slotEl.textContent = `${actTotal}/${actLimit} slots`;

            const activeTab = window.currentTab || 'activities';
            renderActivitiesList(); // always render — it's the default tab and stats depend on it
            if (activeTab === 'dimensions') renderDimensions();
            if (activeTab === 'challenges') renderChallenges();
            if (activeTab === 'rewards') renderRewards();
            if (activeTab === 'settings') renderStreakPauseList();
            if (activeTab === 'analytics') { try { renderDimProgress(); } catch(e) {} }
        }

        // ── Activity Sort & Filter ────────────────────────────────────────
        const SORT_OPTIONS = [
            { id: 'grouped',     icon: '📋', label: 'Grouped by frequency' },
            { id: 'due-first',   icon: '🎯', label: 'Due today first' },
            { id: 'xp-high',     icon: '⬆️', label: 'Highest XP first' },
            { id: 'xp-low',      icon: '⬇️', label: 'Lowest XP first' },
            { id: 'streak-high', icon: '🔥', label: 'Longest streak first' },
            { id: 'alpha',       icon: '🔤', label: 'Alphabetical (A–Z)' },
        ];

        let _currentSort = null; // set on render

        function getCurrentSort() {
            return _currentSort || (window.userData.settings?.activitySort) || 'grouped';
        }

        window.toggleFilterPanel = function() {
            const panel = document.getElementById('filterPanel');
            const btn = document.getElementById('filterBtn');
            const isOpen = panel.style.display !== 'none';
            if (isOpen) {
                panel.style.display = 'none';
                btn.classList.remove('active');
            } else {
                renderFilterOptions();
                panel.style.display = 'block';
                btn.classList.add('active');
            }
        };

        function renderFilterOptions() {
            const current = getCurrentSort();
            const container = document.getElementById('filterOptions');
            if (!container) return;
            container.innerHTML = SORT_OPTIONS.map(o => `
                <button class="filter-option ${current === o.id ? 'selected' : ''}" onclick="applyActivitySort('${o.id}')">
                    <span class="fo-icon">${o.icon}</span>
                    ${o.label}
                    ${current === o.id ? '<svg style="margin-left:auto;flex-shrink:0;" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                </button>
            `).join('');
        }

        window.applyActivitySort = function(sortId) {
            _currentSort = sortId;
            renderFilterOptions();
            // Update active dot
            const dot = document.getElementById('filterActiveDot');
            if (dot) dot.style.display = (sortId !== 'grouped') ? 'block' : 'none';
            renderActivitiesList();
        };

        window.setDefaultActivitySort = function() {
            const sort = getCurrentSort();
            if (!window.userData.settings) window.userData.settings = {};
            window.userData.settings.activitySort = sort;
            saveUserData();
            // Close panel
            const panel = document.getElementById('filterPanel');
            const btn = document.getElementById('filterBtn');
            if (panel) panel.style.display = 'none';
            if (btn) btn.classList.remove('active');
            showToast(`✓ "${SORT_OPTIONS.find(o=>o.id===sort)?.label}" set as default`, 'olive');
        };

        // Close filter panel when clicking outside
        document.addEventListener('click', function(e) {
            const btn = document.getElementById('filterBtn');
            const panel = document.getElementById('filterPanel');
            if (btn && panel && !btn.contains(e.target) && !panel.contains(e.target)) {
                panel.style.display = 'none';
                btn.classList.remove('active');
            }
        });

        // Render Activities List (flat view)
        function renderActivitiesList() {
            const container = document.getElementById('activitiesListContainer');
            const data = window.userData;
            let allActivities = [];

            // Collect all activities with their dimension and path info
            (data.dimensions || []).forEach(dim => {
                (dim.paths || []).forEach(path => {
                    (path.activities || []).forEach(activity => {
                        allActivities.push({
                            ...activity,
                            dimensionName: dim.name,
                            pathName: path.name,
                            dimensionId: dim.id,
                            pathId: path.id
                        });
                    });
                });
            });

            if (allActivities.length === 0) {
                container.innerHTML = `
                    <div class="empty-state" style="padding: 60px 20px;">
                        <div class="empty-state-icon">🚀</div>
                        <p style="font-size:16px;font-weight:600;color:var(--color-text-primary);margin-bottom:8px;">Ready to level up your life?</p>
                        <p style="margin-bottom:24px;">Set up your first Dimension and Path, then add activities to start earning XP.</p>
                        <button class="cta-button" onclick="switchTab('dimensions')">🎯 &nbsp;Set up Dimensions</button>
                    </div>
                `;
                return;
            }

            // Initialise sort from stored preference on first render
            if (!_currentSort) {
                _currentSort = (window.userData.settings?.activitySort) || 'grouped';
                const dot = document.getElementById('filterActiveDot');
                if (dot) dot.style.display = (_currentSort !== 'grouped') ? 'block' : 'none';
            }

            const sort = getCurrentSort();

            if (sort === 'grouped') {
                // Group by frequency (original view)
                const groups = [
                    { key: 'daily',      label: 'Daily Activities',      activities: allActivities.filter(a => a.frequency === 'daily') },
                    { key: 'occasional', label: 'Occasional Activities',  activities: allActivities.filter(a => a.frequency === 'occasional' || a.frequency === 'one-time') },
                    { key: 'weekly',     label: 'Weekly Activities',      activities: allActivities.filter(a => a.frequency === 'weekly') },
                    { key: 'biweekly',   label: 'Bi-weekly Activities',   activities: allActivities.filter(a => a.frequency === 'biweekly') },
                    { key: 'monthly',    label: 'Monthly Activities',     activities: allActivities.filter(a => a.frequency === 'monthly') },
                    { key: 'custom',     label: 'Custom Interval',        activities: allActivities.filter(a => a.frequency === 'custom') },
                ].filter(g => g.activities.length > 0);

                if (!window.activityGroupExpanded) window.activityGroupExpanded = {};

                container.innerHTML = groups.map(g => {
                    const isExpanded = window.activityGroupExpanded[g.key] !== false;
                    return `
                    <div class="act-group" data-group="${g.key}">
                        <div class="act-group-header" onclick="toggleActivityGroup('${g.key}')">
                            <span class="collapse-icon ${isExpanded ? 'expanded' : ''}">▼</span>
                            <span class="act-group-label">${g.label}</span>
                            <span class="act-group-count">${g.activities.length}</span>
                        </div>
                        <div class="act-group-body ${isExpanded ? 'expanded' : ''}">
                            ${renderActivityCards(g.activities)}
                        </div>
                    </div>`;
                }).join('');
            } else {
                // Flat sorted list
                let sorted = [...allActivities];
                if (sort === 'due-first') {
                    // Incomplete activities first, then completed, both sorted by XP desc within group
                    sorted.sort((a, b) => {
                        const aDone = isCompletedToday(a) ? 1 : 0;
                        const bDone = isCompletedToday(b) ? 1 : 0;
                        if (aDone !== bDone) return aDone - bDone;
                        return (b.baseXP || 0) - (a.baseXP || 0);
                    });
                } else if (sort === 'xp-high') {
                    sorted.sort((a, b) => (b.baseXP || 0) - (a.baseXP || 0));
                } else if (sort === 'xp-low') {
                    sorted.sort((a, b) => (a.baseXP || 0) - (b.baseXP || 0));
                } else if (sort === 'streak-high') {
                    sorted.sort((a, b) => (b.streak || 0) - (a.streak || 0));
                } else if (sort === 'alpha') {
                    sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                }
                const sortLabel = SORT_OPTIONS.find(o => o.id === sort)?.label || '';
                container.innerHTML = `
                    <div class="act-group">
                        <div class="act-group-header" style="cursor:default;pointer-events:none;">
                            <span class="act-group-label">${sortLabel}</span>
                            <span class="act-group-count">${sorted.length}</span>
                        </div>
                        <div class="act-group-body expanded">
                            ${renderActivityCards(sorted)}
                        </div>
                    </div>`;
            }
        }

        window.toggleActivityGroup = function(key) {
            if (!window.activityGroupExpanded) window.activityGroupExpanded = {};
            window.activityGroupExpanded[key] = window.activityGroupExpanded[key] === false ? true : false;
            renderActivitiesList();
        };

        // Update challenges on activity completion
        function updateChallengeProgress(activityId) {
            const challenges = window.userData.challenges || [];
            const today = new Date().toISOString().split('T')[0];
            
            challenges.forEach(challenge => {
                if (challenge.status !== 'active') return;
                
                // Check if challenge is within date range — if expired, just leave it as active
                // (user must manually complete or delete; no auto-fail)
                if (today < challenge.startDate || today > challenge.endDate) return;
                
                // Resolve which activity IDs count (support legacy single activityId)
                const challengeActivityIds = challenge.activityIds && challenge.activityIds.length > 0
                    ? challenge.activityIds
                    : (challenge.activityId ? [challenge.activityId] : []);

                const matchesActivity = challengeActivityIds.length === 0 || challengeActivityIds.includes(activityId);
                if (!matchesActivity) return;

                // Per-activity target tracking
                if (challengeActivityIds.length > 0 && challenge.activityTargets && challenge.activityTargets[activityId] !== undefined) {
                    if (!challenge.activityProgress) challenge.activityProgress = {};
                    challenge.activityProgress[activityId] = (challenge.activityProgress[activityId] || 0) + 1;
                    // Recompute overall currentCount as sum of capped per-activity progress
                    challenge.currentCount = challengeActivityIds.reduce((sum, id) => {
                        const target = challenge.activityTargets[id] || 1;
                        return sum + Math.min(challenge.activityProgress[id] || 0, target);
                    }, 0);
                } else {
                    challenge.currentCount++;
                }
                // Note: challenges only complete via the "Complete" button — never auto-complete here
            });
        }

        // Reverse one completion unit for a given activity across all active challenges
        function undoChallengeProgress(activityId) {
            const challenges = window.userData.challenges || [];
            const today = new Date().toISOString().split('T')[0];
            challenges.forEach(challenge => {
                if (challenge.status !== 'active') return;
                if (today < challenge.startDate || today > challenge.endDate) return;
                const challengeActivityIds = challenge.activityIds && challenge.activityIds.length > 0
                    ? challenge.activityIds
                    : (challenge.activityId ? [challenge.activityId] : []);
                const matchesActivity = challengeActivityIds.length === 0 || challengeActivityIds.includes(activityId);
                if (!matchesActivity) return;
                if (challengeActivityIds.length > 0 && challenge.activityTargets && challenge.activityTargets[activityId] !== undefined) {
                    if (challenge.activityProgress && challenge.activityProgress[activityId] > 0) {
                        challenge.activityProgress[activityId]--;
                    }
                    challenge.currentCount = challengeActivityIds.reduce((sum, id) => {
                        const target = challenge.activityTargets[id] || 1;
                        return sum + Math.min((challenge.activityProgress || {})[id] || 0, target);
                    }, 0);
                } else {
                    challenge.currentCount = Math.max(0, (challenge.currentCount || 0) - 1);
                }
            });
        }

        function showChallengeCompleteToast(challengeName, bonusXP) {
            const toast = document.createElement('div');
            toast.style.cssText = `
                position: fixed;
                top: 100px;
                right: 20px;
                background: var(--color-accent-olive);
                color: var(--color-text-primary);
                padding: 16px 24px;
                border-radius: 12px;
                font-weight: 600;
                font-size: 16px;
                z-index: 10000;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
                animation: slideIn 0.3s ease;
            `;
            
            toast.textContent = `🏆 Challenge Complete: ${challengeName} • +${bonusXP} XP`;
            document.body.appendChild(toast);
            
            setTimeout(() => {
                toast.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => toast.remove(), 300);
            }, 4000);
        }

        function renderActivityCards(activities) {
            // Build a set of activity IDs that are part of active challenges
            const challengeActivityIds = new Set();
            (window.userData.challenges || []).forEach(ch => {
                if (ch.status !== 'active') return;
                (ch.activityIds || (ch.activityId ? [ch.activityId] : [])).forEach(id => challengeActivityIds.add(id));
            });

            return activities.map(activity => {
                const completedToday = isCompletedToday(activity);
                const canComplete = canCompleteActivity(activity);
                const inChallenge = challengeActivityIds.has(activity.id);
                const allowMulti = activity.allowMultiplePerDay && activity.frequency !== 'occasional';

                // Compute the XP the user would earn right now (including streak bonus)
                const isOccasional = activity.frequency === 'occasional';
                const isSkipMode = !!activity.isSkipNegative;
                const currentStreak = isOccasional ? 0 : (activity.streak || 0);
                const previewStreak = completedToday ? currentStreak : currentStreak + 1;
                const mult = isOccasional ? 1 : calculateConsistencyMultiplier(previewStreak);
                const displayXP = Math.floor(activity.baseXP * mult);
                const showBonus = mult > 1;

                // Custom activity: counter badge and non-scheduled day greying
                let counterBadge = '';
                let notScheduledToday = false;
                if (activity.frequency === 'custom') {
                    const done   = cycleCompletionsNow(activity);
                    const needed = activity.timesPerCycle || 1;
                    if (activity.customSubtype === 'days' && !isScheduledDay(activity)) {
                        notScheduledToday = true;
                    }
                    if (allowMulti) {
                        // Multi-complete custom: show "×N today · Y/Z cycle" so neither stat is lost
                        const todayCount = countCompletionsToday(activity);
                        counterBadge = `<span class="activity-badge badge-counter">${todayCount > 0 ? `\u00d7${todayCount} today \u00b7 ` : ''}${done}/${needed} cycle</span>`;
                    } else {
                        counterBadge = `<span class="activity-badge badge-counter">${done}/${needed}</span>`;
                    }
                } else if (allowMulti) {
                    // Non-custom multi-complete: just show today count
                    const todayCount = countCompletionsToday(activity);
                    if (todayCount > 0) {
                        counterBadge = `<span class="activity-badge badge-counter">\u00d7${todayCount} today</span>`;
                    }
                }

                let clickHandler, itemClass;
                if (notScheduledToday) {
                    clickHandler = 'void(0)';
                    itemClass = 'disabled';
                } else if (allowMulti) {
                    // Multi-complete: card always clickable to log another; completed style only after ≥1 today
                    clickHandler = `completeActivityById('${activity.id}')`;
                    itemClass = completedToday ? 'completed-multi' : (isSkipMode ? 'skip-mode-pending' : '');
                } else if (completedToday) {
                    // Once-per-day completed: card non-clickable, undo button shown
                    clickHandler = 'void(0)';
                    itemClass = 'completed';
                } else if (canComplete) {
                    clickHandler = `completeActivityById('${activity.id}')`;
                    itemClass = isSkipMode ? 'skip-mode-pending' : '';
                } else {
                    clickHandler = 'void(0)';
                    itemClass = 'disabled';
                }

                // Undo button: shown whenever there is at least one completion today,
                // including partial custom-cycle progress (e.g. 1/4 done).
                const todayCompletionCount = countCompletionsToday(activity);
                const showUndo = todayCompletionCount > 0 && !notScheduledToday;
                const undoLabel = allowMulti ? '↩ Undo' : '↩ Undo';
                const undoBtn = showUndo
                    ? `<button class="btn-undo-activity" onclick="event.stopPropagation();undoActivityById('${activity.id}')" title="Undo last completion">${undoLabel}</button>`
                    : '';

                // XP badge label
                let xpBadgeLabel, xpBadgeClass;
                if (isSkipMode) {
                    xpBadgeLabel = completedToday
                        ? `+${displayXP} XP earned`
                        : `+${displayXP} XP (skip = −${activity.baseXP})`;
                    xpBadgeClass = 'badge-xp';
                } else {
                    xpBadgeLabel = `${activity.isNegative ? '−' : '+'}${displayXP} XP${showBonus ? ` <span style="opacity:0.75;font-size:10px;">(${mult}×)</span>` : ''}`;
                    xpBadgeClass = activity.isNegative ? 'badge-negative' : 'badge-xp';
                }

                // At-risk: daily activity with streak not done today, only warn after 10pm
                const atRisk = !completedToday && !notScheduledToday
                    && activity.streak > 0 && activity.frequency === 'daily'
                    && new Date().getHours() >= 22;

                // Missed-penalty tag: show if penalty was applied today
                const todayIso = new Date().toISOString().split('T')[0];
                const showPenaltyTag = activity.isSkipNegative
                    && activity.lastPenaltyDate === todayIso
                    && (activity.lastPenaltyDays || 0) > 0;
                const penaltyDays = activity.lastPenaltyDays || 0;

                return `
                <div class="activity-item ${itemClass}" onclick="${clickHandler}">
                    <div class="activity-info-container">
                        <div class="activity-name">${escapeHtml(activity.name)}</div>
                        <div class="activity-details">
                            <span class="activity-badge badge-frequency">
                                ${activity.dimensionName} › ${activity.pathName}
                            </span>
                            <span class="activity-badge ${xpBadgeClass}" title="${showBonus ? `${mult}× streak bonus` : ''}">
                                ${xpBadgeLabel}
                            </span>
                            ${currentStreak > 0 ? `<span class="activity-badge badge-streak">🔥 ${currentStreak}</span>` : ''}
                            ${atRisk ? `<span class="activity-badge badge-at-risk">⚠ at risk</span>` : ''}
                            ${showPenaltyTag ? `<span class="activity-badge badge-penalty">⚡ −${penaltyDays}d penalty</span>` : ''}
                            ${counterBadge}
                            ${inChallenge ? `<span class="activity-badge" style="background:rgba(122,123,77,0.18);color:var(--color-accent-olive);border:1px solid rgba(122,123,77,0.35);">🏅 Challenge</span>` : ''}
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
                        ${undoBtn}
                        <div class="activity-check">✓</div>
                    </div>
                </div>
            `}).join('');
        }

        // Complete activity by ID (for flat activities view)
        window.completeActivityById = async function(activityId) {
            const data = window.userData;
            
            // Find the activity
            for (let dimIndex = 0; dimIndex < (data.dimensions || []).length; dimIndex++) {
                const dim = data.dimensions[dimIndex];
                for (let pathIndex = 0; pathIndex < (dim.paths || []).length; pathIndex++) {
                    const path = dim.paths[pathIndex];
                    const actIndex = (path.activities || []).findIndex(a => a.id === activityId);
                    if (actIndex !== -1) {
                        await completeActivity(dimIndex, pathIndex, actIndex);
                        return;
                    }
                }
            }
        };

        // Undo activity by ID (for flat activities view)
        window.undoActivityById = async function(activityId) {
            const data = window.userData;
            
            // Find the activity
            for (let dimIndex = 0; dimIndex < (data.dimensions || []).length; dimIndex++) {
                const dim = data.dimensions[dimIndex];
                for (let pathIndex = 0; pathIndex < (dim.paths || []).length; pathIndex++) {
                    const path = dim.paths[pathIndex];
                    const actIndex = (path.activities || []).findIndex(a => a.id === activityId);
                    if (actIndex !== -1) {
                        await undoActivity(dimIndex, pathIndex, actIndex);
                        return;
                    }
                }
            }
        };

        // Calculate activity limit based on level: 2^(x-1) + 3, capped at 250
        // L1: 4, L2: 5, L3: 7, L4: 11, L5: 19, L6: 35 … L8: 131, L9: 259→capped at 250
        function getActivityLimit(level) {
            return Math.min(250, Math.pow(2, level - 1) + 3);
        }

        // Check if user can add more activities
        function canAddActivity() {
            const level = window.userData.level || 1;
            let totalActivities = 0;
            (window.userData.dimensions || []).forEach(dim => {
                (dim.paths || []).forEach(path => {
                    totalActivities += (path.activities || []).length;
                });
            });
            return totalActivities < getActivityLimit(level);
        }

        function getActivityCounts() {
            let total = 0;
            (window.userData.dimensions || []).forEach(dim => {
                (dim.paths || []).forEach(path => { total += (path.activities || []).length; });
            });
            const level = window.userData.level || 1;
            const limit = getActivityLimit(level);
            return { total, limit };
        }

        // Render Dimensions
        function renderDimensions() {
            const container = document.getElementById('dimensionsContainer');
            const dimensions = window.userData.dimensions || [];

            if (dimensions.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">🎯</div>
                        <p>No dimensions yet. Create your first dimension to get started!</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = dimensions.map((dim, dimIndex) => {
                const cat = window.LIFE_CATEGORIES.find(c => c.id === dim.lifeCategory);
                const catBadge = cat
                    ? `<span class="dim-cat-pill" style="background:rgba(${_hexToRgbStr(cat.color)},0.12);color:${cat.color};border:1px solid rgba(${_hexToRgbStr(cat.color)},0.3);">${cat.emoji} ${cat.label}</span>`
                    : `<span class="dim-cat-pill dim-cat-pill--unset" onclick="event.stopPropagation();editDimension(${dimIndex})" title="Assign a life category">+ category</span>`;
                return `
                <div class="dimension-card">
                    <div class="dimension-header" onclick="toggleDimension(${dimIndex})">
                        <span class="collapse-icon ${dim.expanded ? 'expanded' : ''}">▼</span>
                        <div class="dimension-info">
                            <div class="dimension-name">${escapeHtml(dim.name)}</div>
                            <div class="dimension-meta" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                                <span>${(dim.paths || []).length} paths • ${countDimensionActivities(dim)} activities</span>
                                ${catBadge}
                            </div>
                        </div>
                        <div class="dimension-actions" onclick="event.stopPropagation()">
                            <button class="btn-icon" onclick="openPathModal(${dimIndex})">+ Path</button>
                            <button class="btn-icon" onclick="editDimension(${dimIndex})">Edit</button>
                            <button class="btn-icon delete" onclick="deleteDimension(${dimIndex})">Delete</button>
                        </div>
                    </div>
                    <div class="dimension-content ${dim.expanded ? 'expanded' : ''}">
                        ${renderPaths(dim.paths || [], dimIndex)}
                    </div>
                </div>`;
            }).join('');
        }

        function countDimensionActivities(dimension) {
            let count = 0;
            (dimension.paths || []).forEach(path => {
                count += (path.activities || []).length;
            });
            return count;
        }

        function renderPaths(paths, dimIndex) {
            if (paths.length === 0) {
                return '<div class="empty-state"><p>No paths yet. Click "+ Path" to add one.</p></div>';
            }

            return paths.map((path, pathIndex) => `
                <div class="path-card">
                    <div class="path-header" onclick="togglePath(${dimIndex}, ${pathIndex})">
                        <span class="collapse-icon ${path.expanded ? 'expanded' : ''}">▼</span>
                        <div style="flex:1;min-width:0;">
                            <div class="path-name">${escapeHtml(path.name)}</div>
                            <div style="font-size: 12px; color: var(--color-text-secondary); margin-top: 2px;">
                                ${(path.activities || []).length} activities
                            </div>
                        </div>
                        <div class="dimension-actions" onclick="event.stopPropagation()">
                            <button class="btn-icon" onclick="openActivityModal(${dimIndex}, ${pathIndex})">+ Activity</button>
                            <button class="btn-icon" onclick="editPath(${dimIndex}, ${pathIndex})">Edit</button>
                            <button class="btn-icon delete" onclick="deletePath(${dimIndex}, ${pathIndex})">Delete</button>
                        </div>
                    </div>
                    <div class="path-content ${path.expanded ? 'expanded' : ''}">
                        ${renderActivities(path.activities || [], dimIndex, pathIndex)}
                    </div>
                </div>
            `).join('');
        }

        // Challenge Modal Functions
        let editingChallengeIndex = null;

        window.toggleMetricSection = function() {
            const hiddenInput = document.getElementById('challengeMetricEnabled');
            const grp = document.getElementById('challengeMetricGroup');
            const btn = document.getElementById('metricToggleBtn');
            const check = document.getElementById('metricToggleCheck');
            if (!hiddenInput || !grp) return;
            const isActive = hiddenInput.value === '1';
            const newActive = !isActive;
            hiddenInput.value = newActive ? '1' : '0';
            grp.style.display = newActive ? 'block' : 'none';
            if (btn) btn.classList.toggle('active', newActive);
            if (check) check.textContent = newActive ? '✓' : '';
        };

        window.onChallengeTypeChange = function() {
            const isSpecific = document.getElementById('challengeActivityType').value === 'specific';
            document.getElementById('challengeActivitySelectGroup').style.display = isSpecific ? 'block' : 'none';
            document.getElementById('challengeGlobalTargetRow').style.display = isSpecific ? 'none' : 'grid';
            const xpSpecific = document.getElementById('challengeXPSpecific');
            if (xpSpecific) xpSpecific.required = isSpecific;
            document.getElementById('challengeXP').required = !isSpecific;
        };

        window.openChallengeModal = function(index = null) {
            editingChallengeIndex = index;
            const modal = document.getElementById('challengeModal');
            const title = document.getElementById('challengeModalTitle');
            const submitBtn = document.getElementById('challengeSubmitBtn');

            if (index !== null) {
                title.textContent = 'Edit Challenge';
                if (submitBtn) submitBtn.textContent = 'Save Challenge';
                const challenge = window.userData.challenges[index];
                const selectedIds = challenge.activityIds || (challenge.activityId ? [challenge.activityId] : []);
                const activityTargets = challenge.activityTargets || {};
                populateChallengeActivitySelect(selectedIds, activityTargets);
                document.getElementById('challengeName').value = challenge.name;
                document.getElementById('challengeDescription').value = challenge.description || '';
                document.getElementById('challengeStartDate').value = challenge.startDate;
                document.getElementById('challengeEndDate').value = challenge.endDate;
                const hasSpecific = selectedIds.length > 0;
                document.getElementById('challengeActivityType').value = hasSpecific ? 'specific' : 'any';
                onChallengeTypeChange();
                if (!hasSpecific) {
                    document.getElementById('challengeXP').value = challenge.bonusXP;
                }
                // Restore enforce toggle
                const enforceEl = document.getElementById('challengeEnforceActivities');
                if (enforceEl) enforceEl.checked = !!(challenge.enforceActivities);
                // Metric
                const metricEnabled = !!(challenge.metricEnabled && challenge.metricQty && challenge.metricUnit);
                const hiddenMetric = document.getElementById('challengeMetricEnabled');
                const metricBtn = document.getElementById('metricToggleBtn');
                const metricCheck = document.getElementById('metricToggleCheck');
                if (hiddenMetric) hiddenMetric.value = metricEnabled ? '1' : '0';
                if (metricBtn) metricBtn.classList.toggle('active', metricEnabled);
                if (metricCheck) metricCheck.textContent = metricEnabled ? '✓' : '';
                document.getElementById('challengeMetricGroup').style.display = metricEnabled ? 'block' : 'none';
                if (metricEnabled) {
                    document.getElementById('challengeMetricQty').value = challenge.metricQty;
                    document.getElementById('challengeMetricUnit').value = challenge.metricUnit;
                }
            } else {
                title.textContent = 'Create Challenge';
                if (submitBtn) submitBtn.textContent = 'Create Challenge';
                populateChallengeActivitySelect([], {});
                document.getElementById('challengeForm').reset();
                const _hm = document.getElementById('challengeMetricEnabled');
                const _mb = document.getElementById('metricToggleBtn');
                const _mc = document.getElementById('metricToggleCheck');
                const _enf = document.getElementById('challengeEnforceActivities');
                if (_hm) _hm.value = '0';
                if (_mb) _mb.classList.remove('active');
                if (_mc) _mc.textContent = '';
                if (_enf) _enf.checked = false;
                document.getElementById('challengeMetricGroup').style.display = 'none';
                onChallengeTypeChange();
                const today = new Date().toISOString().split('T')[0];
                const nextMonth = new Date();
                nextMonth.setMonth(nextMonth.getMonth() + 1);
                document.getElementById('challengeStartDate').value = today;
                document.getElementById('challengeEndDate').value = nextMonth.toISOString().split('T')[0];
            }
            
            modal.classList.add('active');
        };

        window.closeChallengeModal = function() {
            document.getElementById('challengeModal').classList.remove('active');
            editingChallengeIndex = null;
        };

        function populateChallengeActivitySelect(selectedIds = [], activityTargets = {}) {
            const checklist = document.getElementById('challengeActivityChecklist');
            const emptyMsg = document.getElementById('challengeActivityChecklistEmpty');
            checklist.innerHTML = '';

            let allActivities = [];
            (window.userData.dimensions || []).forEach(dim => {
                (dim.paths || []).forEach(path => {
                    (path.activities || []).forEach(activity => {
                        allActivities.push({
                            id: activity.id,
                            name: activity.name,
                            baseXP: activity.baseXP || 0,
                            path: `${dim.name} → ${path.name}`
                        });
                    });
                });
            });

            if (allActivities.length === 0) {
                emptyMsg.style.display = 'block';
                updateChallengeXPPreview();
                return;
            }
            emptyMsg.style.display = 'none';

            allActivities.forEach(activity => {
                const item = document.createElement('div');
                const isChecked = selectedIds.includes(activity.id);
                item.className = `activity-checklist-item${isChecked ? ' checked' : ''}`;
                const checkId = `challenge-activity-${activity.id}`;
                const targetInputId = `challenge-target-${activity.id}`;
                const savedTarget = activityTargets[activity.id] || 1;
                item.innerHTML = `
                    <input type="checkbox" id="${checkId}" value="${activity.id}" data-basexp="${activity.baseXP}" ${isChecked ? 'checked' : ''}>
                    <label for="${checkId}">
                        ${escapeHtml(activity.name)}
                        <span>${escapeHtml(activity.path)} &nbsp;·&nbsp; ${activity.baseXP} XP base</span>
                    </label>
                    <div class="target-input-wrap">
                        <input type="number" id="${targetInputId}" value="${savedTarget}" min="1" placeholder="1" onclick="event.stopPropagation()">
                        <label style="cursor:default;">times</label>
                    </div>
                `;
                const checkbox = item.querySelector('input[type="checkbox"]');
                const targetInput = item.querySelector(`#${targetInputId}`);
                checkbox.addEventListener('change', function() {
                    item.classList.toggle('checked', this.checked);
                    updateChallengeXPPreview();
                });
                targetInput.addEventListener('input', updateChallengeXPPreview);
                checklist.appendChild(item);
            });
            updateChallengeXPPreview();
        }

        // Calculate and display auto-XP for specific-activity challenges
        function updateChallengeXPPreview() {
            const preview = document.getElementById('challengeXPPreview');
            const previewVal = document.getElementById('challengeXPPreviewValue');
            if (!preview || !previewVal) return;
            const { totalBaseXP } = calcChallengeAutoXP();
            if (totalBaseXP > 0) {
                const bonus = Math.max(1, Math.round(totalBaseXP * 0.2));
                previewVal.textContent = `+${bonus} XP`;
                preview.style.display = 'block';
            } else {
                preview.style.display = 'none';
            }
        }

        // Returns { totalBaseXP, bonusXP } from the currently selected activities in the modal
        function calcChallengeAutoXP() {
            const items = document.querySelectorAll('#challengeActivityChecklist .activity-checklist-item');
            let totalBaseXP = 0;
            items.forEach(item => {
                const checkbox = item.querySelector('input[type="checkbox"]');
                if (checkbox && checkbox.checked) {
                    const baseXP = parseInt(checkbox.dataset.basexp || 0);
                    const id = checkbox.value;
                    const targetInput = item.querySelector(`#challenge-target-${id}`);
                    const target = targetInput ? Math.max(1, parseInt(targetInput.value) || 1) : 1;
                    totalBaseXP += baseXP * target;
                }
            });
            return { totalBaseXP, bonusXP: Math.max(1, Math.round(totalBaseXP * 0.2)) };
        }

        function getSelectedChallengeActivitiesWithTargets() {
            const items = document.querySelectorAll('#challengeActivityChecklist .activity-checklist-item');
            const result = { activityIds: [], activityTargets: {} };
            items.forEach(item => {
                const checkbox = item.querySelector('input[type="checkbox"]');
                if (checkbox && checkbox.checked) {
                    const id = checkbox.value;
                    const targetInput = item.querySelector(`#challenge-target-${id}`);
                    const target = targetInput ? Math.max(1, parseInt(targetInput.value) || 1) : 1;
                    result.activityIds.push(id);
                    result.activityTargets[id] = target;
                }
            });
            return result;
        }

        // Keep legacy helper for compatibility
        function getSelectedChallengeActivityIds() {
            return getSelectedChallengeActivitiesWithTargets().activityIds;
        }

        window.saveChallenge = async function(event) {
            event.preventDefault();
            
            const name = document.getElementById('challengeName').value;
            const description = document.getElementById('challengeDescription').value;
            const bonusXPEl = document.getElementById('challengeXP');
            const startDate = document.getElementById('challengeStartDate').value;
            const endDate = document.getElementById('challengeEndDate').value;
            const activityType = document.getElementById('challengeActivityType').value;

            // Metric
            const metricEnabled = document.getElementById('challengeMetricEnabled').value === '1';
            const metricQty = metricEnabled ? parseFloat(document.getElementById('challengeMetricQty').value) : null;
            const metricUnit = metricEnabled ? document.getElementById('challengeMetricUnit').value.trim() : null;
            if (metricEnabled && (!metricQty || !metricUnit)) {
                alert('Please fill in both Quantity and Unit for the goal metric, or uncheck it.'); return;
            }

            let activityIds = [];
            let activityTargets = {};
            let targetCount;
            let bonusXP;
            let enforceActivities = false;

            if (activityType === 'specific') {
                const selected = getSelectedChallengeActivitiesWithTargets();
                activityIds = selected.activityIds;
                activityTargets = selected.activityTargets;
                if (activityIds.length === 0) { alert('Please select at least one activity.'); return; }
                targetCount = Object.values(activityTargets).reduce((a, b) => a + b, 0);
                // Auto-calculate bonus XP as 20% of total base XP across all activity completions
                bonusXP = calcChallengeAutoXP().bonusXP;
                enforceActivities = document.getElementById('challengeEnforceActivities')?.checked || false;
            } else {
                targetCount = 0;
                bonusXP = parseInt(bonusXPEl.value);
                if (!bonusXP || bonusXP < 1) { alert('Please enter a Bonus XP value.'); return; }
            }
            
            if (editingChallengeIndex !== null) {
                const challenge = window.userData.challenges[editingChallengeIndex];
                challenge.name = name;
                challenge.description = description;
                challenge.targetCount = targetCount;
                challenge.bonusXP = bonusXP;
                challenge.startDate = startDate;
                challenge.endDate = endDate;
                challenge.activityIds = activityIds;
                challenge.activityTargets = activityTargets;
                challenge.activityId = null;
                challenge.metricQty = metricQty;
                challenge.metricUnit = metricUnit;
                challenge.metricEnabled = metricEnabled;
                challenge.enforceActivities = enforceActivities;
                if (!challenge.activityProgress) challenge.activityProgress = {};
            } else {
                if (!window.userData.challenges) window.userData.challenges = [];
                const activityProgress = {};
                activityIds.forEach(id => { activityProgress[id] = 0; });
                window.userData.challenges.push({
                    id: Date.now().toString(),
                    name, description, targetCount, bonusXP,
                    startDate, endDate, activityIds, activityTargets, activityProgress,
                    activityId: null, currentCount: 0,
                    metricEnabled, metricQty, metricUnit, metricCurrent: 0,
                    activityProgressCollapsed: true,
                    enforceActivities,
                    status: 'active',
                    createdAt: new Date().toISOString()
                });
            }
            
            await saveUserData();
            closeChallengeModal();
            updateDashboard();
        };

        window.completeChallenge = async function(index) {
            const challenge = window.userData.challenges[index];
            if (!challenge || challenge.status !== 'active') return;
            if (!confirm(`Mark "${challenge.name}" as completed? You'll earn the full ${challenge.bonusXP} XP bonus.`)) return;

            challenge.status = 'completed';
            challenge.currentCount = challenge.targetCount; // show full progress bar
            window.userData.currentXP += challenge.bonusXP;
            window.userData.totalXP += challenge.bonusXP;

            // Check for level up
            let level = window.userData.level || 1;
            let xpForNext = calculateXPForLevel(level);
            let didLevelUp = false;
            while (window.userData.currentXP >= xpForNext && level < 100) {
                window.userData.currentXP -= xpForNext;
                window.userData.level++;
                level = window.userData.level;
                xpForNext = calculateXPForLevel(level);
                didLevelUp = true;
            }
            if (window.userData.level >= 100) window.userData.level = 100;
            if (didLevelUp) showLevelUpAnimation();

            showChallengeCompleteToast(challenge.name, challenge.bonusXP);
            await saveUserData();
            updateDashboard();
        };

        window.undoChallenge = async function(index) {
            const challenge = window.userData.challenges[index];
            if (!challenge || challenge.status !== 'completed') return;
            if (!confirm(`Undo completion of "${challenge.name}"? The ${challenge.bonusXP} XP bonus will be returned.`)) return;

            challenge.status = 'active';
            // Reset currentCount so the "all targets met" banner doesn't immediately reappear.
            // Count actual completions from activityProgress if available, else set to 0.
            if (challenge.activityProgress && Object.keys(challenge.activityProgress).length > 0) {
                challenge.currentCount = Object.values(challenge.activityProgress).reduce((a, b) => a + b, 0);
            } else {
                challenge.currentCount = 0;
            }
            window.userData.currentXP -= challenge.bonusXP;
            window.userData.totalXP -= challenge.bonusXP;

            // Handle level-down if XP went negative
            while (window.userData.currentXP < 0 && window.userData.level > 1) {
                window.userData.level -= 1;
                window.userData.currentXP += calculateXPForLevel(window.userData.level);
            }
            if (window.userData.currentXP < 0) window.userData.currentXP = 0;

            await saveUserData();
            updateDashboard();
            showToast(`↩ Challenge un-completed — ${challenge.bonusXP} XP returned`, 'olive');
        };

        window.editChallenge = function(index) {
            openChallengeModal(index);
        };

        window.deleteChallenge = async function(index) {
            if (confirm('Delete this challenge?')) {
                window.userData.challenges.splice(index, 1);
                await saveUserData();
                updateDashboard();
            }
        };

        // Challenge activity type handled by onChallengeTypeChange()

        // Render Challenges
        function renderChallenges() {
            const container = document.getElementById('challengesContainer');
            const challenges = window.userData.challenges || [];

            if (challenges.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">🏆</div>
                        <p>No challenges yet. Create your first challenge to earn bonus XP!</p>
                    </div>
                `;
                return;
            }

            const activeChallenges = challenges.filter(c => c.status === 'active');
            const completedChallenges = challenges.filter(c => c.status === 'completed');
            const failedChallenges = challenges.filter(c => c.status === 'failed');

            let html = '';

            if (activeChallenges.length > 0) {
                html += `<h3 style="margin: 24px 0 12px 0; font-size: 18px;">Active Challenges</h3>`;
                html += activeChallenges.map(challenge => renderChallengeCard(challenge, challenges.indexOf(challenge))).join('');
            }

            if (completedChallenges.length > 0) {
                html += `<h3 style="margin: 24px 0 12px 0; font-size: 18px;">Completed</h3>`;
                html += completedChallenges.map(challenge => renderChallengeCard(challenge, challenges.indexOf(challenge))).join('');
            }

            if (failedChallenges.length > 0) {
                html += `<h3 style="margin: 24px 0 12px 0; font-size: 18px;">Failed</h3>`;
                html += failedChallenges.map(challenge => renderChallengeCard(challenge, challenges.indexOf(challenge))).join('');
            }

            container.innerHTML = html;
        }

        window.updateMetricProgress = async function(challengeId) {
            const challenges = window.userData.challenges || [];
            const challenge = challenges.find(c => c.id === challengeId);
            if (!challenge) return;
            const inputEl = document.getElementById('metric-input-' + challengeId);
            if (!inputEl) return;
            const val = parseFloat(inputEl.value);
            if (isNaN(val) || val < 0) { showToast('Enter a valid number', 'red'); return; }
            challenge.metricCurrent = val;
            await saveUserData();
            updateDashboard();
            showToast('✓ Progress updated', 'olive');
        };

        window.toggleActivityProgress = function(challengeId) {
            const body = document.getElementById('ch-breakdown-' + challengeId);
            const icon = document.getElementById('ch-breakdown-icon-' + challengeId);
            if (!body) return;
            const isNowCollapsed = body.classList.toggle('collapsed');
            // Drive the max-height for smooth animation
            body.style.maxHeight = isNowCollapsed ? '0' : (body.scrollHeight + 60) + 'px';
            if (icon) icon.textContent = isNowCollapsed ? '▶' : '▼';
            const challenges = window.userData.challenges || [];
            const ch = challenges.find(c => c.id === challengeId);
            if (ch) { ch.activityProgressCollapsed = isNowCollapsed; saveUserData(); }
        };

        function renderChallengeCard(challenge, index) {
            const isActive   = challenge.status === 'active';
            const isCompleted = challenge.status === 'completed';
            const isFailed   = challenge.status === 'failed';
            const daysLeft   = Math.ceil((new Date(challenge.endDate) - new Date()) / (1000 * 60 * 60 * 24));

            // Name map
            const nameMap = {};
            (window.userData.dimensions || []).forEach(dim =>
                (dim.paths || []).forEach(path =>
                    (path.activities || []).forEach(act => { nameMap[act.id] = act.name; })));

            const challengeActivityIds = challenge.activityIds && challenge.activityIds.length > 0
                ? challenge.activityIds
                : (challenge.activityId ? [challenge.activityId] : []);

            const hasPerActivity = challengeActivityIds.length > 0
                && challenge.activityTargets && Object.keys(challenge.activityTargets).length > 0;
            const hasMetric = !!(challenge.metricEnabled && challenge.metricQty && challenge.metricUnit);

            // Compute activity progress
            let activityPct = 0;
            let activityRowsHtml = '';
            if (hasPerActivity) {
                const totalTarget  = challengeActivityIds.reduce((s, id) => s + (challenge.activityTargets[id] || 1), 0);
                const totalCurrent = challengeActivityIds.reduce((s, id) =>
                    s + Math.min((challenge.activityProgress || {})[id] || 0, challenge.activityTargets[id] || 1), 0);
                activityPct = totalTarget > 0 ? Math.min(100, (totalCurrent / totalTarget) * 100) : 0;

                activityRowsHtml = challengeActivityIds.map(id => {
                    const target  = challenge.activityTargets[id] || 1;
                    const current = Math.min((challenge.activityProgress || {})[id] || 0, target);
                    const pct     = Math.min(100, (current / target) * 100);
                    const done    = current >= target;
                    const barFill = done ? 'var(--color-accent-green)'
                        : isCompleted ? 'var(--color-accent-green)'
                        : isFailed ? 'var(--color-accent-red)' : 'var(--color-accent-blue)';
                    return `
                        <div class="ch-act-row"><span class="ch-act-row-name${done?' done':''}">${done?'✓ ':''}${escapeHtml(nameMap[id]||id)}</span><span class="ch-act-row-count">${current}/${target}</span></div>
                        <div class="ch-act-bar-track"><div class="ch-bar-fill" style="width:${pct}%;background:${barFill};"></div></div>`;
                }).join('');
            }

            const allTargetsMet = isActive && hasPerActivity && activityPct >= 100;
            const barMainColor  = isCompleted ? 'var(--color-accent-green)'
                : isFailed ? 'var(--color-accent-red)'
                : allTargetsMet ? 'var(--color-accent-green)' : 'var(--color-accent-blue)';

            // ── Progress HTML ──────────────────────────────────────────────
            let progressHtml = '';

            if (hasMetric) {
                const metricCurrent = challenge.metricCurrent || 0;
                const metricPct = Math.min(100, (metricCurrent / challenge.metricQty) * 100);
                const metricFill = metricPct >= 100 ? 'var(--color-accent-green)' : barMainColor;

                progressHtml += `
                <div class="ch-progress-block">
                    <div class="ch-progress-label">
                        <span class="ch-progress-label-name">🎯 ${escapeHtml(challenge.metricUnit)} goal</span>
                        <span class="ch-progress-label-val">${metricCurrent} / ${challenge.metricQty} ${escapeHtml(challenge.metricUnit)}&nbsp;&nbsp;${Math.floor(metricPct)}%</span>
                    </div>
                    <div class="ch-bar-track"><div class="ch-bar-fill" style="width:${metricPct}%;background:${metricFill};"></div></div>
                    ${isActive ? `
                    <div class="ch-update-row">
                        <input class="ch-update-input" type="number" id="metric-input-${challenge.id}" placeholder="Current value" step="any" min="0" value="${metricCurrent > 0 ? metricCurrent : ''}">
                        <button type="button" class="ch-update-btn" onclick="updateMetricProgress('${challenge.id}')">Update</button>
                    </div>` : ''}
                </div>`;

                if (hasPerActivity) {
                    const collapsed = challenge.activityProgressCollapsed !== false;
                    progressHtml += `
                <div class="ch-breakdown-toggle" onclick="toggleActivityProgress('${challenge.id}')">
                    <span>📋 Activity breakdown &nbsp;<span style="color:var(--color-accent-blue);font-weight:600;">${Math.floor(activityPct)}%</span></span>
                    <span id="ch-breakdown-icon-${challenge.id}">${collapsed ? '▶' : '▼'}</span>
                </div>
                <div class="ch-breakdown-body${collapsed ? ' collapsed' : ''}" id="ch-breakdown-${challenge.id}" style="max-height:${collapsed ? '0' : '600px'};">
                    <div style="padding-top:10px;">${activityRowsHtml}</div>
                </div>`;
                }

            } else if (hasPerActivity) {
                // No metric: activity bars ARE the main progress
                progressHtml += `
                <div class="ch-progress-block">
                    <div class="ch-progress-label">
                        <span class="ch-progress-label-name">Progress</span>
                        <span class="ch-progress-label-val">${Math.floor(activityPct)}%</span>
                    </div>
                    <div class="ch-bar-track"><div class="ch-bar-fill" style="width:${activityPct}%;background:${barMainColor};"></div></div>
                </div>
                <div style="margin-bottom:4px;">${activityRowsHtml}</div>`;

            } else {
                // Any-activity, no metric
                const anyCount = challenge.currentCount || 0;
                progressHtml += `
                <div class="ch-progress-block">
                    <div class="ch-progress-label">
                        <span class="ch-progress-label-name">Completions</span>
                        <span class="ch-progress-label-val">${anyCount} activities done</span>
                    </div>
                    <div class="ch-bar-track"><div class="ch-bar-fill" style="width:${isCompleted?100:0}%;background:var(--color-accent-green);"></div></div>
                </div>`;
            }

            // ── Card class ─────────────────────────────────────────────────
            const cardClass = isCompleted ? 'challenge-card completed'
                : isFailed ? 'challenge-card failed'
                : allTargetsMet ? 'challenge-card targets-met'
                : 'challenge-card';

            // ── Ready banner ───────────────────────────────────────────────
            const readyBanner = allTargetsMet ? `
                <div class="ch-ready-banner">🎯 <strong>All targets met!</strong>&nbsp; Click "Complete" to claim your bonus.</div>` : '';

            // ── Activity badge ─────────────────────────────────────────────
            const actBadge = challengeActivityIds.length === 0 ? '' :
                `<span class="activity-badge" style="background:rgba(74,124,158,0.15);color:var(--color-accent-blue);" title="${escapeHtml(challengeActivityIds.map(id=>nameMap[id]||id).join(', '))}">📌 ${challengeActivityIds.length} activit${challengeActivityIds.length===1?'y':'ies'}</span>`;

            // Enforce toggle: block completion if activities aren't all done yet
            const enforced = !!(challenge.enforceActivities) && hasPerActivity;
            const completeBlocked = enforced && !allTargetsMet;

            return `
                <div class="${cardClass}">
                    <div class="ch-header">
                        <div style="flex:1;min-width:0;">
                            <h3 class="ch-title">${escapeHtml(challenge.name)}</h3>
                            ${challenge.description ? `<p class="ch-desc">${escapeHtml(challenge.description)}</p>` : ''}
                        </div>
                        <div class="ch-actions">
                            ${isActive ? `
                                <button class="btn-complete-challenge${allTargetsMet?' btn-complete-ready':''}" onclick="completeChallenge(${index})"
                                    ${completeBlocked ? 'disabled title="Complete all activity targets first"' : ''}>✓ Complete</button>
                                <button class="btn-icon" onclick="editChallenge(${index})">Edit</button>
                                <button class="btn-icon delete" onclick="deleteChallenge(${index})">✕</button>
                            ` : isCompleted ? `
                                <button class="btn-icon" onclick="undoChallenge(${index})" style="border-color:var(--color-accent-red);color:#e07070;" title="Undo">↩</button>
                            ` : ''}
                        </div>
                    </div>

                    ${readyBanner}
                    ${progressHtml}

                    <div class="ch-tags">
                        <span class="activity-badge badge-xp">+${challenge.bonusXP} XP</span>
                        ${isActive ? `<span class="activity-badge badge-frequency">${daysLeft > 0 ? daysLeft + ' days left' : 'Ends today'}</span>` : ''}
                        ${hasMetric ? `<span class="activity-badge" style="background:rgba(90,159,212,0.12);color:var(--color-progress);">🎯 ${challenge.metricQty} ${escapeHtml(challenge.metricUnit)}</span>` : ''}
                        ${actBadge}
                        ${enforced ? `<span class="activity-badge" style="background:rgba(142,59,95,0.15);color:#e07070;" title="Must complete all activity targets">🔒 Enforced</span>` : ''}
                        ${isCompleted ? `<span class="activity-badge" style="background:rgba(107,124,63,0.2);color:var(--color-accent-green);">✓ Completed</span>` : ''}
                        ${isFailed ? `<span class="activity-badge badge-negative">✗ Failed</span>` : ''}
                    </div>
                </div>
            `;
        }


                function renderActivities(activities, dimIndex, pathIndex) {
            if (activities.length === 0) {
                return '<div class="empty-state"><p>No activities yet. Click "+ Activity" to add one.</p></div>';
            }

            const freqLabel = { daily:'Daily', occasional:'Occasional', weekly:'Weekly', biweekly:'Bi-weekly', monthly:'Monthly', custom:'Custom', 'one-time':'Occasional' };

            return activities.map((activity, actIndex) => {
                const completedToday = isCompletedToday(activity);
                const canComplete = canCompleteActivity(activity);
                const allowMulti = activity.allowMultiplePerDay && activity.frequency !== 'occasional';

                let clickHandler, itemClass;
                if (allowMulti) {
                    clickHandler = `completeActivity(${dimIndex}, ${pathIndex}, ${actIndex})`;
                    itemClass = completedToday ? 'completed-multi' : '';
                } else if (completedToday) {
                    // Completed: non-clickable; undo via explicit button
                    clickHandler = 'void(0)';
                    itemClass = 'completed';
                } else if (canComplete) {
                    clickHandler = `completeActivity(${dimIndex}, ${pathIndex}, ${actIndex})`;
                    itemClass = '';
                } else {
                    clickHandler = 'void(0)';
                    itemClass = 'disabled';
                }

                const freqText = freqLabel[activity.frequency] || activity.frequency;
                const customNote = activity.frequency === 'custom' && activity.customDays ? ` (${activity.customDays}d)` : '';

                const showUndo = countCompletionsToday(activity) > 0;
                const undoBtn = showUndo
                    ? `<button class="btn-undo-activity" onclick="event.stopPropagation();undoActivity(${dimIndex}, ${pathIndex}, ${actIndex})" title="Undo">↩</button>`
                    : '';

                // For custom activities that require multiple completions, show
                // both how many were done today and the overall cycle progress.
                let customProgressBadge = '';
                if (activity.frequency === 'custom' && (activity.timesPerCycle || 1) > 1) {
                    const doneInCycle = cycleCompletionsNow(activity);
                    const needed     = activity.timesPerCycle || 1;
                    const doneToday  = countCompletionsToday(activity);
                    customProgressBadge = `<span class="activity-badge" style="background:rgba(90,159,212,0.12);color:var(--color-progress);">${doneToday} today &middot; ${doneInCycle}/${needed} cycle</span>`;
                }

                return `
                <div class="activity-item ${itemClass}" onclick="${clickHandler}">
                    <div class="activity-info-container">
                        <div class="activity-name">${escapeHtml(activity.name)}</div>
                        <div class="activity-details">
                            <span class="activity-badge badge-frequency">${freqText}${customNote}</span>
                            <span class="activity-badge ${activity.isNegative ? 'badge-negative' : 'badge-xp'}">
                                ${activity.isNegative ? '−' : '+'}${activity.baseXP} XP
                            </span>
                            ${activity.streak > 0 ? `<span class="activity-badge badge-streak">🔥 ${activity.streak}</span>` : ''}
                            ${customProgressBadge}
                        </div>
                    </div>
                    <div class="dimension-actions" onclick="event.stopPropagation()">
                        ${undoBtn}
                        <div class="activity-check">✓</div>
                        <button class="btn-icon" onclick="editActivity(${dimIndex}, ${pathIndex}, ${actIndex})">Edit</button>
                        <button class="btn-icon delete" onclick="deleteActivity(${dimIndex}, ${pathIndex}, ${actIndex})">Delete</button>
                    </div>
                </div>
            `}).join('');
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Toggle Functions
        window.toggleDimension = function(dimIndex) {
            window.userData.dimensions[dimIndex].expanded = !window.userData.dimensions[dimIndex].expanded;
            renderDimensions();
        };

        window.togglePath = function(dimIndex, pathIndex) {
            window.userData.dimensions[dimIndex].paths[pathIndex].expanded =
                !window.userData.dimensions[dimIndex].paths[pathIndex].expanded;
            renderDimensions();
        };

        // Dimension Modal Functions
        let editingDimensionIndex = null;

        window.openDimensionModal = function(index = null) {
            editingDimensionIndex = index;
            const modal = document.getElementById('dimensionModal');
            const title = document.getElementById('dimensionModalTitle');
            
            if (index !== null) {
                title.textContent = 'Edit Dimension';
                const dim = window.userData.dimensions[index];
                document.getElementById('dimensionName').value = dim.name;
                document.getElementById('dimensionColor').value = dim.color || 'blue';
                const lc = document.getElementById('dimensionLifeCategory');
                if (lc) lc.value = dim.lifeCategory || '';
            } else {
                title.textContent = 'Create Dimension';
                document.getElementById('dimensionForm').reset();
                const lc = document.getElementById('dimensionLifeCategory');
                if (lc) lc.value = '';
            }
            
            modal.classList.add('active');
        };

        window.closeDimensionModal = function() {
            document.getElementById('dimensionModal').classList.remove('active');
            editingDimensionIndex = null;
        };

        window.saveDimension = async function(event) {
            event.preventDefault();
            
            const name = document.getElementById('dimensionName').value;
            const color = document.getElementById('dimensionColor').value;
            const lifeCategory = document.getElementById('dimensionLifeCategory')?.value || '';
            
            if (editingDimensionIndex !== null) {
                window.userData.dimensions[editingDimensionIndex].name = name;
                window.userData.dimensions[editingDimensionIndex].color = color;
                window.userData.dimensions[editingDimensionIndex].lifeCategory = lifeCategory;
            } else {
                window.userData.dimensions.push({
                    id: Date.now().toString(),
                    name,
                    color,
                    lifeCategory,
                    paths: [],
                    expanded: true,
                    createdAt: new Date().toISOString()
                });
            }
            
            await saveUserData();
            closeDimensionModal();
            updateDashboard();
        };

        window.editDimension = function(index) {
            openDimensionModal(index);
        };

        window.deleteDimension = async function(index) {
            if (confirm('Delete this dimension and all its paths/activities?')) {
                const dim = window.userData.dimensions[index];
                getActivityIdsInDimension(dim).forEach(id => cleanupChallengesForActivity(id));
                window.userData.dimensions.splice(index, 1);
                await saveUserData();
                updateDashboard();
            }
        };

        // Path Modal Functions
        let editingPathDimIndex = null;
        let editingPathIndex = null;

        window.openPathModal = function(dimIndex, pathIndex = null) {
            editingPathDimIndex = dimIndex;
            editingPathIndex = pathIndex;
            const modal = document.getElementById('pathModal');
            const title = document.getElementById('pathModalTitle');
            
            if (pathIndex !== null) {
                title.textContent = 'Edit Path';
                const path = window.userData.dimensions[dimIndex].paths[pathIndex];
                document.getElementById('pathName').value = path.name;
            } else {
                title.textContent = 'Create Path';
                document.getElementById('pathForm').reset();
            }
            
            modal.classList.add('active');
        };

        window.closePathModal = function() {
            document.getElementById('pathModal').classList.remove('active');
            editingPathDimIndex = null;
            editingPathIndex = null;
        };

        window.savePath = async function(event) {
            event.preventDefault();
            
            const name = document.getElementById('pathName').value;
            
            if (editingPathIndex !== null) {
                window.userData.dimensions[editingPathDimIndex].paths[editingPathIndex].name = name;
            } else {
                if (!window.userData.dimensions[editingPathDimIndex].paths) {
                    window.userData.dimensions[editingPathDimIndex].paths = [];
                }
                window.userData.dimensions[editingPathDimIndex].paths.push({
                    id: Date.now().toString(),
                    name,
                    activities: [],
                    expanded: true,
                    createdAt: new Date().toISOString()
                });
            }
            
            await saveUserData();
            closePathModal();
            updateDashboard();
        };

        window.editPath = function(dimIndex, pathIndex) {
            openPathModal(dimIndex, pathIndex);
        };

        window.deletePath = async function(dimIndex, pathIndex) {
            if (confirm('Delete this path and all its activities?')) {
                const path = window.userData.dimensions[dimIndex].paths[pathIndex];
                (path.activities || []).forEach(act => cleanupChallengesForActivity(act.id));
                window.userData.dimensions[dimIndex].paths.splice(pathIndex, 1);
                await saveUserData();
                updateDashboard();
            }
        };

        // Activity Modal Functions
        let editingActivityDimIndex = null;
        let editingActivityPathIndex = null;
        let editingActivityIndex = null;

        window.openActivityModal = function(dimIndex, pathIndex, actIndex = null) {
            const limitNotice = document.getElementById('activityLimitNotice');
            
            if (actIndex === null && !canAddActivity()) {
                const { total, limit } = getActivityCounts();
                const level = window.userData.level || 1;
                // Find next level that unlocks more
                let nextUnlockLevel = level + 1;
                while (getActivityLimit(nextUnlockLevel) <= limit) nextUnlockLevel++;
                document.getElementById('limitCurrent').textContent = total;
                document.getElementById('limitMax').textContent = limit;
                document.getElementById('limitNextLevel').textContent = nextUnlockLevel;
                limitNotice.style.display = 'block';
                document.querySelector('#activityForm button[type="submit"]').disabled = true;
            } else {
                limitNotice.style.display = 'none';
                document.querySelector('#activityForm button[type="submit"]').disabled = false;
            }
            
            editingActivityDimIndex = dimIndex;
            editingActivityPathIndex = pathIndex;
            editingActivityIndex = actIndex;
            const modal = document.getElementById('activityModal');
            const title = document.getElementById('activityModalTitle');
            
            if (actIndex !== null) {
                title.textContent = 'Edit Activity';
                const activity = window.userData.dimensions[dimIndex].paths[pathIndex].activities[actIndex];
                document.getElementById('activityName').value = activity.name;
                document.getElementById('activityXP').value = activity.baseXP;
                document.getElementById('activityFrequency').value = activity.frequency;
                // Negative XP fields
                const isNegEnabled = !!(activity.isNegative || activity.isSkipNegative);
                document.getElementById('activityNegativeEnabled').checked = isNegEnabled;
                document.getElementById('negativeXpSection').style.display = isNegEnabled ? 'block' : 'none';
                const mode = activity.negativeXpMode || (activity.isNegative ? 'perform' : 'skip');
                const modeEl = document.querySelector(`input[name="negativeXpMode"][value="${mode}"]`);
                if (modeEl) modeEl.checked = true;
                // Allow multiple per day
                const multiEl = document.getElementById('activityAllowMultiple');
                if (multiEl) multiEl.checked = activity.allowMultiplePerDay || false;
                document.getElementById('activityDeleteOnComplete').checked = activity.deleteOnComplete || false;
                toggleCustomDays();
                if (activity.frequency === 'custom') {
                    const sub = activity.customSubtype || 'cycle';
                    setCustomSubtypeUI(sub);
                    if (sub === 'cycle') {
                        document.getElementById('activityCustomDays').value = activity.customDays || 3;
                    } else {
                        setSelectedDays(activity.scheduledDays || []);
                    }
                    document.getElementById('activityCustomTimes').value = activity.timesPerCycle || 1;
                }
            } else {
                title.textContent = 'Create Activity';
                document.getElementById('activityForm').reset();
                document.getElementById('activityFrequency').value = 'daily'; // always reset to daily
                document.getElementById('activityNegativeEnabled').checked = false;
                document.getElementById('negativeXpSection').style.display = 'none';
                document.querySelector('input[name="negativeXpMode"][value="perform"]').checked = true;
                const grp = document.getElementById('customDaysGroup');
                if (grp) grp.style.display = 'none';
                const multiGrp = document.getElementById('allowMultipleGroup');
                if (multiGrp) multiGrp.style.display = 'none';
                toggleCustomDays(); // ensure custom days hidden
            }
            
            modal.classList.add('active');
        };

        window.toggleCustomDays = function() {
            const freq = document.getElementById('activityFrequency').value;
            const grp  = document.getElementById('customDaysGroup');
            const occGrp = document.getElementById('occasionalDeleteGroup');
            const multiGrp = document.getElementById('allowMultipleGroup');
            if (!grp) return;
            grp.style.display = (freq === 'custom') ? 'block' : 'none';
            if (occGrp) occGrp.style.display = (freq === 'occasional') ? 'block' : 'none';
            // Show "allow multiple per day" for all non-occasional frequencies
            if (multiGrp) multiGrp.style.display = (freq !== 'occasional') ? 'block' : 'none';
        };

        window.setCustomSubtype = function(type) {
            const cycleGrp   = document.getElementById('cycleSubGroup');
            const weekdayGrp = document.getElementById('weekdaySubGroup');
            const btnCycle   = document.getElementById('subtypeCycle');
            const btnDays    = document.getElementById('subtypeDays');
            if (type === 'cycle') {
                cycleGrp.style.display   = 'block';
                weekdayGrp.style.display = 'none';
                btnCycle.classList.add('active');
                btnDays.classList.remove('active');
            } else {
                cycleGrp.style.display   = 'none';
                weekdayGrp.style.display = 'block';
                btnDays.classList.add('active');
                btnCycle.classList.remove('active');
            }
        };

        window.toggleDayBtn = function(btn) {
            btn.classList.toggle('selected');
        };

        // Wire up day picker buttons
        document.querySelectorAll('.day-btn').forEach(btn => {
            btn.addEventListener('click', function() { toggleDayBtn(this); });
        });

        function getSelectedDays() {
            return [...document.querySelectorAll('.day-btn.selected')].map(b => parseInt(b.dataset.day));
        }
        function setSelectedDays(days) {
            document.querySelectorAll('.day-btn').forEach(b => {
                b.classList.toggle('selected', (days || []).includes(parseInt(b.dataset.day)));
            });
        }
        function getCustomSubtype() {
            const btn = document.getElementById('subtypeCycle');
            return (btn && btn.classList.contains('active')) ? 'cycle' : 'days';
        }
        function setCustomSubtypeUI(type) {
            setCustomSubtype(type);
        }

        window.closeActivityModal = function() {
            document.getElementById('activityModal').classList.remove('active');
            editingActivityDimIndex = null;
            editingActivityPathIndex = null;
            editingActivityIndex = null;
        };

        window.toggleNegativeXpSection = function() {
            const enabled = document.getElementById('activityNegativeEnabled').checked;
            document.getElementById('negativeXpSection').style.display = enabled ? 'block' : 'none';
        };

        window.saveActivity = async function(event) {
            event.preventDefault();
            
            const name = document.getElementById('activityName').value;
            const baseXP = Math.min(50, Math.max(1, parseInt(document.getElementById('activityXP').value) || 1));
            const frequency = document.getElementById('activityFrequency').value;
            const isNegativeEnabled = document.getElementById('activityNegativeEnabled').checked;
            const negativeXpMode = isNegativeEnabled
                ? (document.querySelector('input[name="negativeXpMode"]:checked')?.value || 'perform')
                : null;
            const isNegative = isNegativeEnabled && negativeXpMode === 'perform';
            const isSkipNegative = isNegativeEnabled && negativeXpMode === 'skip';
            const allowMultiplePerDay = (frequency !== 'occasional')
                ? (document.getElementById('activityAllowMultiple')?.checked || false)
                : false;
            const subtype = frequency === 'custom' ? getCustomSubtype() : null;
            const customDays = (frequency === 'custom' && subtype === 'cycle') ? Math.max(1, parseInt(document.getElementById('activityCustomDays').value) || 3) : null;
            const scheduledDays = (frequency === 'custom' && subtype === 'days') ? getSelectedDays() : null;
            const timesPerCycle = frequency === 'custom' ? Math.max(1, parseInt(document.getElementById('activityCustomTimes').value) || 1) : null;
            const deleteOnComplete = frequency === 'occasional' ? document.getElementById('activityDeleteOnComplete').checked : false;

            if (editingActivityIndex !== null) {
                const activity = window.userData.dimensions[editingActivityDimIndex]
                    .paths[editingActivityPathIndex].activities[editingActivityIndex];
                activity.name = name;
                activity.baseXP = baseXP;
                activity.frequency = frequency;
                activity.isNegative = isNegative;
                activity.isSkipNegative = isSkipNegative;
                activity.negativeXpMode = negativeXpMode;
                activity.allowMultiplePerDay = allowMultiplePerDay;
                if (frequency === 'custom') {
                    activity.customSubtype = subtype;
                    activity.customDays = customDays;
                    activity.scheduledDays = scheduledDays;
                    activity.timesPerCycle = timesPerCycle;
                } else {
                    activity.customSubtype = null;
                    activity.customDays = null;
                    activity.scheduledDays = null;
                    activity.timesPerCycle = null;
                }
                activity.deleteOnComplete = deleteOnComplete;
            } else {
                if (!canAddActivity()) {
                    alert('You\'ve reached your activity limit! Level up to unlock more.');
                    return;
                }
                
                const path = window.userData.dimensions[editingActivityDimIndex]
                    .paths[editingActivityPathIndex];
                if (!path.activities) {
                    path.activities = [];
                }
                path.activities.push({
                    id: Date.now().toString(),
                    name, baseXP, frequency, isNegative, isSkipNegative, negativeXpMode,
                    allowMultiplePerDay,
                    customSubtype: subtype,
                    customDays,
                    scheduledDays,
                    timesPerCycle,
                    deleteOnComplete,
                    streak: 0,
                    skipStreak: 0,
                    lastCompleted: null,
                    cycleCompletions: 0,
                    totalXP: 0,
                    completionCount: 0,
                    createdAt: new Date().toISOString()
                });
            }
            
            await saveUserData();
            closeActivityModal();
            updateDashboard();
        };

        window.editActivity = function(dimIndex, pathIndex, actIndex) {
            openActivityModal(dimIndex, pathIndex, actIndex);
        };

        window.deleteActivity = async function(dimIndex, pathIndex, actIndex) {
            if (confirm('Delete this activity?')) {
                const activity = window.userData.dimensions[dimIndex].paths[pathIndex].activities[actIndex];
                const actId = activity ? activity.id : null;

                // Preserve today's XP contribution so the "XP Today" stat isn't
                // reduced when a completed activity is deleted (undo is the path
                // that should deduct XP; delete is just removing the record).
                const _todayStr  = new Date().toDateString();
                const _todayKey  = new Date().toISOString().slice(0, 10);
                // Use the actual XP value (not Math.abs) so negative-habit completions
                // don't incorrectly inflate the "XP Today" stat. Exclude auto-penalties.
                const _ghostXP   = (activity.completionHistory || [])
                    .filter(e => !e.isPenalty && new Date(e.date).toDateString() === _todayStr)
                    .reduce((s, e) => s + (e.xp || 0), 0);
                if (_ghostXP > 0) {
                    if (!window.userData.xpTodayGhost) window.userData.xpTodayGhost = {};
                    window.userData.xpTodayGhost[_todayKey] =
                        (window.userData.xpTodayGhost[_todayKey] || 0) + _ghostXP;
                }

                // Accumulate the deleted activity's historical XP so "Total XP Earned"
                // in analytics stays accurate (the stat sums completionHistory, which
                // disappears when an activity is removed).
                var _deletedHistXP = (activity.completionHistory || [])
                    .reduce(function(s, e) { return s + (e.xp || 0); }, 0);
                if (_deletedHistXP !== 0) {
                    window.userData.xpDeletedGhost = (window.userData.xpDeletedGhost || 0) + _deletedHistXP;
                }

                window.userData.dimensions[dimIndex].paths[pathIndex].activities.splice(actIndex, 1);
                // Clean up references in challenges
                if (actId) cleanupChallengesForActivity(actId);
                await saveUserData();
                updateDashboard();
            }
        };

        // Remove a deleted activity ID from all challenges
        function cleanupChallengesForActivity(actId) {
            (window.userData.challenges || []).forEach(ch => {
                // activityIds array
                if (ch.activityIds) {
                    ch.activityIds = ch.activityIds.filter(id => id !== actId);
                }
                // activityTargets map
                if (ch.activityTargets) delete ch.activityTargets[actId];
                // activityProgress map
                if (ch.activityProgress) delete ch.activityProgress[actId];
                // Legacy single activityId
                if (ch.activityId === actId) ch.activityId = null;
                // Recalculate targetCount and currentCount
                if (ch.activityIds && ch.activityTargets) {
                    ch.targetCount = ch.activityIds.reduce((s, id) => s + (ch.activityTargets[id] || 1), 0);
                    ch.currentCount = ch.activityIds.reduce((s, id) =>
                        s + Math.min((ch.activityProgress || {})[id] || 0, ch.activityTargets[id] || 1), 0);
                }
            });
        }

        // Collect all activity IDs in a dimension for bulk cleanup
        function getActivityIdsInDimension(dim) {
            const ids = [];
            (dim.paths || []).forEach(path => {
                (path.activities || []).forEach(act => ids.push(act.id));
            });
            return ids;
        }

        // Activity Completion Functions

        // Count how many times a user has completed an activity today.
        // Excludes auto-penalty entries so undo buttons only appear for real completions.
        function countCompletionsToday(activity) {
            const todayStr = new Date().toDateString();
            return (activity.completionHistory || []).filter(
                e => !e.isPenalty && new Date(e.date).toDateString() === todayStr
            ).length;
        }

        function canCompleteActivity(activity) {
            if (activity.frequency === 'custom') return canCompleteCustomToday(activity);
            // allowMultiplePerDay non-custom: always completable (no daily cap applied here;
            // streak cap is handled separately in completeActivity via streakGrantedDate)
            if (activity.allowMultiplePerDay && activity.frequency !== 'occasional') return true;
            return true;
        }

        // Return today's day-of-week index (0=Sun)
        function todayDOW() { return new Date().getDay(); }

        // For custom/days: is today one of the scheduled days?
        function isScheduledDay(activity) {
            if (!activity.scheduledDays || activity.scheduledDays.length === 0) return false;
            return activity.scheduledDays.includes(todayDOW());
        }

        // For custom activities: how many completions in the current cycle?
        function cycleCompletionsNow(activity) {
            // We track completions in the current cycle via cycleHistory array
            // Each entry: { date: ISO string }
            if (!activity.cycleHistory || activity.cycleHistory.length === 0) return 0;
            const now = new Date();
            let windowStart;
            if (activity.customSubtype === 'days') {
                // Weekly window — start of current ISO week (Monday)
                const dow = now.getDay(); // 0=Sun
                const monday = new Date(now);
                monday.setDate(now.getDate() - ((dow + 6) % 7));
                monday.setHours(0,0,0,0);
                windowStart = monday;
            } else {
                // Cycle window — starts at createdAt aligned to multiples of customDays
                const origin = new Date(activity.createdAt || activity.cycleHistory[0].date);
                origin.setHours(0,0,0,0);
                const daysSinceOrigin = Math.floor((now - origin) / 86400000);
                const cycleDays = activity.customDays || 3;
                const cycleNum = Math.floor(daysSinceOrigin / cycleDays);
                windowStart = new Date(origin.getTime() + cycleNum * cycleDays * 86400000);
            }
            return activity.cycleHistory.filter(e => new Date(e.date) >= windowStart).length;
        }

        function isCompletedToday(activity) {
            if (activity.frequency === 'custom') {
                // Fully completed if cycleCompletions >= timesPerCycle in current window
                const done = cycleCompletionsNow(activity);
                const needed = activity.timesPerCycle || 1;
                return done >= needed;
            }

            if (!activity.lastCompleted) return false;
            const lastCompleted = new Date(activity.lastCompleted);
            const today = new Date();
            const daysDiff = Math.floor((today - lastCompleted) / (1000 * 60 * 60 * 24));
            
            if (activity.frequency === 'daily') {
                return lastCompleted.toDateString() === today.toDateString();
            } else if (activity.frequency === 'occasional') {
                return lastCompleted.toDateString() === today.toDateString();
            } else if (activity.frequency === 'weekly') {
                // Reset every Sunday (calendar week boundary) — compare midnight-to-midnight
                const todayMidnight = new Date(); todayMidnight.setHours(0,0,0,0);
                const dow = todayMidnight.getDay(); // 0=Sun
                const weekStart = new Date(todayMidnight); weekStart.setDate(todayMidnight.getDate() - dow);
                // Normalise lastCompleted to local midnight to avoid UTC timezone shifts
                const lcMidnight = new Date(lastCompleted); lcMidnight.setHours(0,0,0,0);
                return lcMidnight >= weekStart;
            } else if (activity.frequency === 'biweekly') {
                // Every other Sunday, anchored to Jan 5 2025
                const biAnchor = new Date('2025-01-05T00:00:00');
                const todayMidnight2 = new Date(); todayMidnight2.setHours(0,0,0,0);
                const weeksSinceAnchor = Math.floor((todayMidnight2 - biAnchor) / (7 * 86400000));
                const cycleStart = new Date(biAnchor.getTime() + (weeksSinceAnchor - (weeksSinceAnchor % 2)) * 7 * 86400000);
                const lcMidnight2 = new Date(lastCompleted); lcMidnight2.setHours(0,0,0,0);
                return lcMidnight2 >= cycleStart;
            } else if (activity.frequency === 'monthly') {
                // Resets on the 1st of each calendar month
                const today2 = new Date();
                const monthStart = new Date(today2.getFullYear(), today2.getMonth(), 1);
                const lcMidnight3 = new Date(lastCompleted); lcMidnight3.setHours(0,0,0,0);
                return lcMidnight3 >= monthStart;
            }
            return false;
        }

        function canCompleteCustomToday(activity) {
            if (activity.customSubtype === 'days') {
                // Must be a scheduled day
                if (!isScheduledDay(activity)) return false;
            }
            // Has remaining completions in cycle?
            const done = cycleCompletionsNow(activity);
            const needed = activity.timesPerCycle || 1;
            if (done >= needed) return false;

            // Daily limit: if allowMultiplePerDay is false (default for newly created activities),
            // only allow one completion per calendar day.
            // For backward compat: activities without allowMultiplePerDay field (old data) treat as true.
            if (activity.allowMultiplePerDay === false) {
                const today = new Date().toDateString();
                const doneToday = (activity.cycleHistory || []).filter(
                    e => new Date(e.date).toDateString() === today
                ).length;
                if (doneToday >= 1) return false;
            }
            return true;
        }

        // ── Streak grace-days helper (pure, no side-effects) ─────────────────
        function getStreakGraceDays(activity) {
            if (activity.frequency === 'daily')    return 1;
            if (activity.frequency === 'weekly')   return 7;
            if (activity.frequency === 'biweekly') return 14;
            if (activity.frequency === 'monthly')  return 30;
            if (activity.frequency === 'custom')   return activity.customSubtype === 'days' ? 7 : (activity.customDays || 1);
            return 1;
        }

        // calculateStreak — READ-ONLY, never mutates activity fields.
        // Safe to call from rendering code without causing silent data changes.
        function calculateStreak(activity) {
            if (!activity.lastCompleted) return activity.streak || 0;
            if (activity.frequency === 'occasional') return 0;

            const lastMidnight = new Date(activity.lastCompleted); lastMidnight.setHours(0,0,0,0);
            const todayMidnight = new Date(); todayMidnight.setHours(0,0,0,0);
            const daysDiff = Math.round((todayMidnight - lastMidnight) / (1000 * 60 * 60 * 24));
            const graceDays = getStreakGraceDays(activity);
            const missedCycles = daysDiff <= graceDays ? 0 : Math.ceil((daysDiff - graceDays) / graceDays);

            // Perform-negative: no shields, streak resets on any miss
            if (activity.isNegative && !activity.isSkipNegative) {
                return missedCycles === 0 ? (activity.streak || 1) : 0;
            }

            const usedShields = activity.streakPauseUses || 0;
            const shieldsLeft = Math.max(0, 3 - usedShields);

            if (missedCycles === 0)          return activity.streak || 1;
            if (missedCycles <= shieldsLeft) return activity.streak || 1; // shields cover it
            return 0;
        }

        // consumeStreakShields — WRITE path only.
        // Called exclusively from completeActivity so shields are consumed exactly
        // once per completion, never silently during a render pass.
        function consumeStreakShields(activity) {
            if (!activity.lastCompleted) return;
            if (activity.frequency === 'occasional') return;
            if (activity.isNegative && !activity.isSkipNegative) return;

            const lastMidnight = new Date(activity.lastCompleted); lastMidnight.setHours(0,0,0,0);
            const todayMidnight = new Date(); todayMidnight.setHours(0,0,0,0);
            const daysDiff = Math.round((todayMidnight - lastMidnight) / (1000 * 60 * 60 * 24));
            const graceDays = getStreakGraceDays(activity);
            const missedCycles = daysDiff <= graceDays ? 0 : Math.ceil((daysDiff - graceDays) / graceDays);
            if (missedCycles === 0) return;

            const usedShields = activity.streakPauseUses || 0;
            const shieldsLeft = Math.max(0, 3 - usedShields);

            if (missedCycles <= shieldsLeft) {
                activity.streakPauseUses = usedShields + missedCycles;
                activity.streakPaused = false;
            } else {
                // Streak already broken — reset shields for the new streak
                activity.streakPauseUses = 0;
                activity.streakPaused = false;
            }
        }

        // Activity XP streak bonus — exponential scaling so high-streak activities
        // can yield the large amounts needed to progress through higher levels.
        // Formula: 1 + 0.1 * (streak^1.5)
        // streak 0-4: ×1.0, streak 5: ×2.1, streak 10: ×4.2, streak 20: ×9.4, streak 30: ×17.4
        function getStreakScaling() {
            return parseFloat(window.userData?.settings?.streakScaling ?? 1.2);
        }

        function calculateConsistencyMultiplier(streak) {
            if (streak <= 0) return 1;
            if (streak < 5)  return 1;
            var exp = getStreakScaling();
            return +(1 + 0.1 * Math.pow(streak, exp)).toFixed(2);
        }

        window.completeActivity = async function(dimIndex, pathIndex, actIndex) {
            const activity = window.userData.dimensions[dimIndex].paths[pathIndex].activities[actIndex];
            
            if (!canCompleteActivity(activity)) {
                return;
            }
            // For once-per-day activities, block if already completed today
            const allowMulti = activity.allowMultiplePerDay && activity.frequency !== 'occasional';
            if (!allowMulti && isCompletedToday(activity)) {
                return;
            }

            // Reset skip streak when user performs a skip-mode activity
            if (activity.isSkipNegative && (activity.skipStreak || 0) > 0) {
                activity.skipStreak = 0;
            }
            
            const isOccasional = activity.frequency === 'occasional';
            const isCustom = activity.frequency === 'custom';
            // Consume streak shields on the write path only (not during rendering)
            if (!isOccasional) consumeStreakShields(activity);
            const currentStreak = isOccasional ? 0 : calculateStreak(activity);

            // Streak incremented once per cycle — for custom, only when first completion of cycle
            const todayStr = new Date().toISOString().slice(0, 10);
            const cycleWasEmpty = isCustom ? (cycleCompletionsNow(activity) === 0) : false;
            const alreadyGrantedToday = (!isCustom && activity.streakGrantedDate === todayStr);
            const shouldGrantStreak = !isOccasional && (isCustom ? cycleWasEmpty : !alreadyGrantedToday);
            const newStreak = isOccasional ? 0 : (shouldGrantStreak ? currentStreak + 1 : currentStreak);
            if (!isOccasional && shouldGrantStreak) {
                activity.streakGrantedDate = todayStr;
            }

            const consistencyMultiplier = isOccasional ? 1 : calculateConsistencyMultiplier(newStreak);
            const earnedXP = Math.floor(activity.baseXP * consistencyMultiplier);
            
            activity.lastCompleted = new Date().toISOString();
            // Track cycle completions for custom activities
            if (isCustom) {
                if (!activity.cycleHistory) activity.cycleHistory = [];
                activity.cycleHistory.push({ date: activity.lastCompleted });
                activity.cycleCompletions = cycleCompletionsNow(activity);
            }
            if (!isOccasional) {
                activity.streak = newStreak;
                activity.bestStreak = Math.max(activity.bestStreak || 0, newStreak);
                if (shouldGrantStreak) checkStreakMilestone(activity.name, newStreak);
            }
            activity.completionCount = (activity.completionCount || 0) + 1;
            activity.totalXP = (activity.totalXP || 0) + earnedXP;
            recordCompletion(activity, activity.isNegative ? -earnedXP : earnedXP);

            // Apply XP to the parent dimension's level track
            const _dimForAct = window.userData.dimensions[dimIndex];
            if (_dimForAct) applyDimXP(_dimForAct, activity.isNegative && !activity.isSkipNegative ? -earnedXP : earnedXP);

            // Update challenge progress
            updateChallengeProgress(activity.id);
            
            // Skip-mode activities give POSITIVE XP when performed (penalty is applied when skipped, not here)
            const xpChange = (activity.isNegative && !activity.isSkipNegative) ? -earnedXP : earnedXP;
            window.userData.currentXP += xpChange;
            window.userData.totalXP += xpChange;
            
            if (activity.isNegative && !activity.isSkipNegative) {
                // Negative habits drain XP and can level you down, but can't take you below 0 on level 1.
                // We allow level-down so the XP math is always reversible on undo.
                while (window.userData.currentXP < 0 && window.userData.level > 1) {
                    window.userData.level -= 1;
                    window.userData.currentXP += calculateXPForLevel(window.userData.level);
                }
                if (window.userData.currentXP < 0) {
                    // At level 1 and still negative — clamp, but record the actual amount deducted
                    // so undo can reverse exactly what happened.
                    activity._lastActualXpDeducted = earnedXP + window.userData.currentXP; // actual deducted (could be less than earnedXP)
                    window.userData.currentXP = 0;
                } else {
                    activity._lastActualXpDeducted = earnedXP; // full amount was deducted
                }
            } else {
                // Loop level-ups until currentXP is within the next threshold
                let leveledUp = false;
                while (window.userData.currentXP >= calculateXPForLevel(window.userData.level) && window.userData.level < 100) {
                    const threshold = calculateXPForLevel(window.userData.level);
                    window.userData.currentXP -= threshold;
                    window.userData.level += 1;
                    leveledUp = true;
                }
                // Hard cap at level 100
                if (window.userData.level >= 100) {
                    window.userData.level = 100;
                }
                if (leveledUp) {
                    window.userData.levelStartedAt = new Date().toISOString();
                    showLevelUpAnimation();
                    updateDashboard();
                    showXPToast(xpChange, newStreak, consistencyMultiplier);
                    saveUserData(); // fire-and-forget — UI already updated
                    return;
                }
            }

            // For deleteOnComplete: remove the activity BEFORE saving so we issue
            // only one Firestore write covering both the XP credit and the deletion.
            if (isOccasional && activity.deleteOnComplete) {
                const dims = window.userData.dimensions;
                outer: for (let di = 0; di < dims.length; di++) {
                    for (let pi = 0; pi < dims[di].paths.length; pi++) {
                        const acts = dims[di].paths[pi].activities || [];
                        const ai = acts.findIndex(a => a.id === activity.id);
                        if (ai !== -1) { acts.splice(ai, 1); break outer; }
                    }
                }
            }
            updateDashboard();
            showXPToast(xpChange, newStreak, consistencyMultiplier);
            saveUserData(); // single write covers XP + optional deletion
        };

        // Undo Activity Completion
        window.undoActivity = async function(dimIndex, pathIndex, actIndex) {
            const activity = window.userData.dimensions[dimIndex].paths[pathIndex].activities[actIndex];
            
            // Must have at least one non-penalty completion today to undo
            const todayStr = new Date().toISOString().slice(0, 10);
            const todayUserEntries = (activity.completionHistory || []).filter(
                e => !e.isPenalty && new Date(e.date).toISOString().slice(0, 10) === todayStr
            );
            const hasCompletionToday = todayUserEntries.length > 0;
            if (!hasCompletionToday && !isCompletedToday(activity)) {
                return;
            }

            const isOccasional = activity.frequency === 'occasional';
            // Read the exact XP that was recorded when this completion was logged.
            // This prevents rounding/multiplier drift between complete and undo.
            const lastUserEntry = (activity.completionHistory || []).filter(e => !e.isPenalty).slice(-1)[0];
            const earnedXP = lastUserEntry ? Math.abs(lastUserEntry.xp || 0) : Math.floor(activity.baseXP);
            const xpChange = (activity.isNegative && !activity.isSkipNegative) ? -earnedXP : earnedXP;
            
            // Remove the last user-initiated (non-penalty) completion entry.
            // We must NOT blindly pop() because auto-penalty entries can appear
            // after user entries in the history (they are appended at login).
            if (activity.completionHistory && activity.completionHistory.length > 0) {
                const lastUserIdx = (() => {
                    for (let _i = activity.completionHistory.length - 1; _i >= 0; _i--) {
                        if (!activity.completionHistory[_i].isPenalty) return _i;
                    }
                    return -1;
                })();
                if (lastUserIdx !== -1) activity.completionHistory.splice(lastUserIdx, 1);
            }
            // Remove last cycleHistory entry for custom activities
            if (activity.frequency === 'custom' && activity.cycleHistory && activity.cycleHistory.length > 0) {
                activity.cycleHistory.pop();
                activity.cycleCompletions = cycleCompletionsNow(activity);
            }

            // Restore lastCompleted from the previous USER entry (not penalties).
            const remainingHistory = activity.completionHistory || [];
            const remainingUserHistory = remainingHistory.filter(e => !e.isPenalty);
            const prevUserEntry = remainingUserHistory.length > 0 ? remainingUserHistory[remainingUserHistory.length - 1] : null;
            if (prevUserEntry) {
                activity.lastCompleted = prevUserEntry.date;
            } else {
                activity.lastCompleted = null;
            }

            // Revert streak grant only if no user completions remain today (exclude penalties)
            const stillHasToday = remainingUserHistory.some(
                e => new Date(e.date).toISOString().slice(0, 10) === todayStr
            );
            if (!isOccasional && !stillHasToday && activity.streakGrantedDate === todayStr && activity.streak > 0) {
                activity.streak = Math.max(0, activity.streak - 1);
                activity.streakGrantedDate = null;
            }
            if (!isOccasional && activity.frequency === 'custom' && activity.cycleCompletions === 0 && activity.streakGrantedDate) {
                // Revert custom streak grant if no completions remain in cycle
                activity.streak = Math.max(0, activity.streak - 1);
                activity.streakGrantedDate = null;
            }

            activity.completionCount = Math.max(0, (activity.completionCount || 1) - 1);
            activity.totalXP = Math.max(0, (activity.totalXP || earnedXP) - earnedXP);
            
            // Revert XP
            let toastXP = xpChange;
            if (activity.isNegative && !activity.isSkipNegative) {
                const actualDeducted = activity._lastActualXpDeducted !== undefined ? activity._lastActualXpDeducted : earnedXP;
                delete activity._lastActualXpDeducted;
                toastXP = -actualDeducted;
                window.userData.currentXP += actualDeducted;
                window.userData.totalXP += actualDeducted;
                let _undoLeveledUp = false;
                while (window.userData.currentXP >= calculateXPForLevel(window.userData.level) && window.userData.level < 100) {
                    window.userData.currentXP -= calculateXPForLevel(window.userData.level);
                    window.userData.level += 1;
                    _undoLeveledUp = true;
                }
                if (window.userData.level >= 100) window.userData.level = 100;
                if (_undoLeveledUp) showLevelUpAnimation();
            } else {
                window.userData.currentXP -= xpChange;
                window.userData.totalXP -= xpChange;
                while (window.userData.currentXP < 0 && window.userData.level > 1) {
                    window.userData.level -= 1;
                    const restoredThreshold = calculateXPForLevel(window.userData.level);
                    window.userData.currentXP += restoredThreshold;
                }
                if (window.userData.currentXP < 0) {
                    window.userData.currentXP = 0;
                }
            }
            
            // Reverse challenge progress for this undo
            undoChallengeProgress(activity.id);

            // Reverse dimension XP for this undo
            const _dimForUndo = window.userData.dimensions[dimIndex];
            if (_dimForUndo) applyDimXP(_dimForUndo, -xpChange);

            updateDashboard();
            showUndoToast(toastXP);
            saveUserData(); // fire-and-forget
        };

        function showUndoToast(xp) {
            // xp = what was originally added (positive for positive activity, negative for negative activity)
            // undo reverses it, so message should reflect what was removed
            const isNegAct = xp < 0; // negative activity was undone → we restored XP
            _showToastPill({
                icon: '↩',
                label: isNegAct ? `+${Math.abs(xp)} XP restored` : `${Math.abs(xp)} XP removed`,
                accent: 'rgba(90,90,60,0.92)',
                accentEnd: 'rgba(122,123,77,0.92)',
                border: 'rgba(122,123,77,0.5)',
            });
        }

        function showXPToast(xp, streak, multiplier) {
            const isPos = xp > 0;
            let label = isPos ? `+${Math.abs(xp)} XP` : `−${Math.abs(xp)} XP (negative habit)`;
            let icon = isPos ? '⚡' : '💔';
            if (isPos && streak > 1) { label += `  🔥 ×${streak}`; }
            if (isPos && multiplier > 1) { label += `  (${multiplier}x)`; }
            _showToastPill({
                icon,
                label,
                accent: isPos ? 'rgba(40,80,130,0.95)' : 'rgba(110,40,70,0.95)',
                accentEnd: isPos ? 'rgba(68,114,160,0.95)' : 'rgba(142,59,95,0.95)',
                border: isPos ? 'rgba(90,159,212,0.5)' : 'rgba(194,90,115,0.5)',
            });
        }

        function _showToastPill({ icon, label, accent, border, accentEnd }) {
            // Remove any existing toast so they don't stack
            document.querySelectorAll('.xp-toast-pill').forEach(t => t.remove());

            const toast = document.createElement('div');
            toast.className = 'xp-toast-pill';
            toast.innerHTML = `
                <span style="font-size:18px;line-height:1;">${icon}</span>
                <span style="font-size:15px;font-weight:700;letter-spacing:-0.02em;">${label}</span>
            `;
            toast.style.cssText = `
                position: fixed;
                top: 88px;
                left: 50%;
                transform: translateX(-50%) translateY(-8px);
                background: linear-gradient(120deg, ${accent}, ${accentEnd || accent});
                border: 1px solid ${border};
                color: #fff;
                padding: 10px 22px;
                border-radius: 99px;
                font-family: inherit;
                display: flex;
                align-items: center;
                gap: 10px;
                z-index: 10000;
                box-shadow: 0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px ${border};
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                animation: toastSlideDown 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards;
                pointer-events: none;
                white-space: nowrap;
            `;
            document.body.appendChild(toast);

            setTimeout(() => {
                toast.style.animation = 'toastFadeUp 0.25s ease forwards';
                setTimeout(() => toast.remove(), 260);
            }, 2400);
        }

        function showLevelUpAnimation() {
            const confettiContainer = document.getElementById('confettiContainer');
            const colors = ['#4a7c9e', '#8e3b5f', '#6b7c3f', '#7a7b4d', '#5a9fd4'];
            
            for (let i = 0; i < 100; i++) {
                const confetti = document.createElement('div');
                confetti.className = 'confetti';
                confetti.style.left = Math.random() * 100 + '%';
                confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
                confetti.style.animationDelay = Math.random() * 0.3 + 's';
                confetti.style.animationDuration = Math.random() * 2 + 2 + 's';
                confetti.style.animation = 'confetti-fall ' + (Math.random() * 2 + 2) + 's ease-out forwards';
                confettiContainer.appendChild(confetti);
                
                setTimeout(() => confetti.remove(), 4000);
            }

            const newLevel = window.userData.level;
            const reward = (window.userData.rewards || {})[newLevel];

            // Share button injector — called after the overlay/toast is in the DOM
            function _injectShareBtn() {
                if (document.getElementById('shareLevelUpBtn')) return;
                const btn = document.createElement('button');
                btn.id = 'shareLevelUpBtn';
                btn.className = 'btn-reward-claim';
                btn.style.cssText = 'margin-top:14px;background:linear-gradient(135deg,var(--color-accent-blue),var(--color-progress));display:inline-flex;align-items:center;gap:8px;';
                btn.innerHTML = '🚀 Share Progress';
                btn.onclick = () => shareLevelUpCard(newLevel);
                // Try reward overlay card first
                const card = document.querySelector('#rewardUnlockOverlay .reward-unlock-card');
                if (card) { card.appendChild(btn); return; }
                // Fallback: plain level-up toast (find by level text)
                document.querySelectorAll('[style*="position: fixed"]').forEach(t => {
                    if (t.textContent.includes(`Level ${newLevel}!`)) {
                        btn.style.cssText += 'pointer-events:all;font-size:14px;padding:8px 18px;';
                        t.style.pointerEvents = 'all';
                        const inner = t.querySelector('div');
                        if (inner) inner.appendChild(btn);
                    }
                });
            }

            if (reward || newLevel === 100) {
                setTimeout(() => { showRewardUnlock(newLevel); setTimeout(_injectShareBtn, 50); }, 600);
            } else {
                // Fallback: simple level-up toast
                const levelUpToast = document.createElement('div');
                levelUpToast.style.cssText = `
                    position: fixed;
                    inset: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10001;
                    pointer-events: none;
                `;
                const inner = document.createElement('div');
                inner.style.cssText = `
                    background: var(--color-bg-card);
                    border: 1px solid var(--color-accent-blue);
                    color: #fff;
                    padding: 28px 44px;
                    border-radius: 24px;
                    font-weight: 800;
                    font-size: clamp(22px, 7vw, 38px);
                    box-shadow: 0 16px 56px rgba(0,0,0,0.65), 0 0 0 1px rgba(90,159,212,0.2);
                    animation: levelUpPop 0.45s cubic-bezier(0.34,1.56,0.64,1) both;
                    text-align: center;
                    white-space: nowrap;
                    max-width: 88vw;
                    letter-spacing: -0.02em;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 6px;
                    pointer-events: all;
                `;
                inner.innerHTML = `<span style="font-size:clamp(30px,9vw,52px);line-height:1;">🎉</span><span>Level ${newLevel}!</span>`;
                levelUpToast.appendChild(inner);
                document.body.appendChild(levelUpToast);
                setTimeout(_injectShareBtn, 80);
                setTimeout(() => levelUpToast.remove(), 5000);
            }
        }

        // Add animations
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(400px);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            
            @keyframes slideOut {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(400px);
                    opacity: 0;
                }
            }
            
            @keyframes scaleIn {
                from {
                    transform: translate(-50%, -50%) scale(0.5);
                    opacity: 0;
                }
                to {
                    transform: translate(-50%, -50%) scale(1);
                    opacity: 1;
                }
            }

            @keyframes levelUpPop {
                from { transform: scale(0.4); opacity: 0; }
                to   { transform: scale(1);   opacity: 1; }
            }

            @keyframes toastSlideDown {
                from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
                to   { opacity: 1; transform: translateX(-50%) translateY(0); }
            }

            @keyframes toastFadeUp {
                from { opacity: 1; transform: translateX(-50%) translateY(0); }
                to   { opacity: 0; transform: translateX(-50%) translateY(-10px); }
            }
        `;
        document.head.appendChild(style);

        // ── Rewards System ────────────────────────────────────────────────

        function renderRewards() {
            // Keep dim selector in sync whenever rewards tab renders
            populateDimRewardSelect();
            const container = document.getElementById('rewardsTimeline');
            if (!container) return;
            const data = window.userData;
            const currentLevel = data.level || 1;
            const rewards = data.rewards || {};
            const VISIBLE_FUTURE = 5;

            // Build a range: past levels that have rewards (min 2), current level, next N levels
            const levelsWithRewards = Object.keys(rewards).map(Number).filter(l => l < currentLevel && l >= 2);
            const startLevel = levelsWithRewards.length > 0 ? Math.min(...levelsWithRewards) : Math.max(2, currentLevel);
            const endLevel = Math.min(99, currentLevel + VISIBLE_FUTURE); // cap so L100 is always appended separately

            let html = '';

            // ── "Add reward for any level" input row ──────────────────────
            html += '<div class="reward-any-level-row">'
                + '<label>🎯 Set reward for any level:</label>'
                + '<input type="number" id="rewardAnyLevelInput" min="2" max="100" placeholder="2–100" style="width:90px;">'
                + '<button class="btn-reward-add" onclick="openRewardForAnyLevel()">➕ Add / Edit</button>'
                + '</div>';

            const levelsToShow = new Set();
            for (let lvl = Math.max(2, startLevel); lvl <= endLevel; lvl++) levelsToShow.add(lvl);
            // Always include any level that already has a reward, even if far in the future
            Object.keys(rewards).map(Number).forEach(function(lvl) { if (lvl >= 2 && lvl < 100) levelsToShow.add(lvl); });
            levelsToShow.add(100); // always show level 100
            for (const lvl of [...levelsToShow].sort((a,b) => a-b)) {
                const reward = rewards[lvl];
                const isUnlocked = lvl < currentLevel;
                const isCurrent = lvl === currentLevel;
                const nodeClass = isUnlocked ? 'unlocked' : isCurrent ? 'current' : 'future';
                const statusLabel = isUnlocked ? '✓ Unlocked' : isCurrent ? '⚡ Current Level' : `Level ${lvl}`;
                const statusBadgeClass = isUnlocked ? 'badge-unlocked' : isCurrent ? 'badge-current' : 'badge-upcoming';

                const rewardContent = reward
                    ? `<div class="reward-title">${reward.icon ? escapeHtml(reward.icon) + ' &nbsp;' : ''}${escapeHtml(reward.title)}</div>
                       ${reward.description ? `<div class="reward-desc">${escapeHtml(reward.description)}</div>` : ''}
                       <div class="reward-card-actions">
                           ${reward.link && isUnlocked ? `<a href="${escapeHtml(reward.link)}" target="_blank" rel="noopener" class="btn-reward-claim">🎁 Claim Reward</a>` : ''}
                           <button class="btn-reward-edit" onclick="openRewardModal(${lvl})">✏️ Edit</button>
                           <button class="btn-reward-delete" onclick="deleteReward(${lvl})" title="Delete reward">✕</button>
                       </div>`
                    : lvl === 100
                    ? `<div class="reward-title" style="filter: blur(6px); user-select:none; pointer-events:none;">🌟 &nbsp;A secret message awaits you at Level 100!</div>
                       <div class="reward-desc" style="margin-top:6px;color:var(--color-text-secondary);font-size:12px;font-style:italic;">Reach Level 100 to reveal your reward.</div>`
                    : `<div class="reward-title" style="color: var(--color-text-secondary); font-style: italic; font-weight: 400;">No reward set yet</div>
                       <div class="reward-card-actions">
                           <button class="btn-reward-add" onclick="openRewardModal(${lvl})">➕ Add reward</button>
                       </div>`;

                html += `
                    <div class="reward-node ${nodeClass}">
                        <div class="reward-node-dot"></div>
                        <div class="reward-card${reward ? ' reward-set' : ''}">
                            <div class="reward-card-header">
                                <span class="reward-level-label">Level ${lvl}</span>
                                <span class="reward-status-badge ${statusBadgeClass}">${statusLabel}</span>
                            </div>
                            ${rewardContent}
                        </div>
                    </div>`;
            }
            container.innerHTML = html;
        }

        window.openRewardForAnyLevel = function() {
            var input = document.getElementById('rewardAnyLevelInput');
            if (!input) return;
            var lvl = parseInt(input.value);
            if (isNaN(lvl) || lvl < 2 || lvl > 100) {
                showToast('Please enter a level between 2 and 100', 'red');
                return;
            }
            openRewardModal(lvl);
        };

        window.openDimRewardForAnyLevel = function() {
            var input = document.getElementById('dimRewardAnyLevelInput');
            var sel = document.getElementById('dimRewardSelect');
            if (!input || !sel) return;
            var dimId = sel.value;
            if (!dimId) { showToast('Select a dimension first', 'red'); return; }
            var lvl = parseInt(input.value);
            if (isNaN(lvl) || lvl < 2 || lvl > 200) {
                showToast('Please enter a level between 2 and 200', 'red');
                return;
            }
            openDimRewardModal(dimId, lvl);
        };

        let editingRewardLevel = null;

        window.openRewardModal = function(level) {
            const currentLevel = window.userData.level || 1;
            editingRewardLevel = level;
            _editingDimRewardDimId = null;
            _editingDimRewardLevel = null;
            document.getElementById('rewardModalTitle').innerHTML = 'Set Reward for Level <span id="rewardModalLevel"></span>';
            document.getElementById('rewardModalLevel').textContent = level;
            const existing = (window.userData.rewards || {})[level];
            document.getElementById('rewardTitle').value = existing ? existing.title : '';
            document.getElementById('rewardDescription').value = existing ? (existing.description || '') : '';
            document.getElementById('rewardLink').value = existing ? (existing.link || '') : '';
            document.getElementById('rewardIcon').value = existing ? (existing.icon || '') : '';
            document.getElementById('rewardModal').classList.add('active');
        };

        window.closeRewardModal = function() {
            document.getElementById('rewardModal').classList.remove('active');
            editingRewardLevel = null;
            _editingDimRewardDimId = null;
            _editingDimRewardLevel = null;
        };

        window.saveReward = async function(event) {
            event.preventDefault();
            const rewardData = {
                title:       document.getElementById('rewardTitle').value,
                description: document.getElementById('rewardDescription').value,
                link:        document.getElementById('rewardLink').value.trim() || null,
                icon:        document.getElementById('rewardIcon').value.trim() || null,
            };
            if (_editingDimRewardDimId && _editingDimRewardLevel !== null) {
                const dim = (window.userData.dimensions || []).find(d => d.id === _editingDimRewardDimId);
                if (dim) { initDim(dim); dim.dimRewards[_editingDimRewardLevel] = rewardData; }
                await saveUserData();
                closeRewardModal();
                renderDimRewards();
            } else {
                if (editingRewardLevel === null) return;
                if (!window.userData.rewards) window.userData.rewards = {};
                window.userData.rewards[editingRewardLevel] = rewardData;
                await saveUserData();
                closeRewardModal();
                renderRewards();
            }
        };

        window.deleteReward = async function(level) {
            if (!confirm('Delete the reward for Level ' + level + '?')) return;
            if (window.userData.rewards) {
                delete window.userData.rewards[level];
                await saveUserData();
                renderRewards();
                showToast('Reward deleted', 'red');
            }
        };

        function showRewardUnlock(level) {
            if (level === 100) {
                document.getElementById('rewardUnlockIcon').textContent = '🌟';
                document.getElementById('rewardUnlockLevel').textContent = '🎉 Level 100 — Legendary!';
                document.getElementById('rewardUnlockTitle').textContent = 'You did it!';
                document.getElementById('rewardUnlockDesc').textContent = 'Amazing! You\'ve finally reached level 100! Settle down, breathe. And take a moment to look back at the life you\'ve created!';
                document.getElementById('rewardUnlockOverlay').style.display = 'flex';
                return;
            }
            const reward = (window.userData.rewards || {})[level];
            if (!reward) return;
            document.getElementById('rewardUnlockIcon').textContent = reward.icon || '🎁';
            document.getElementById('rewardUnlockLevel').textContent = `🎉 Level ${level} Unlocked!`;
            document.getElementById('rewardUnlockTitle').textContent = reward.title;
            document.getElementById('rewardUnlockDesc').textContent = reward.description || '';
            if (reward.link) {
                document.getElementById('rewardUnlockDesc').innerHTML += `<br><a href="${escapeHtml(reward.link)}" target="_blank" rel="noopener" style="color:var(--color-accent-blue);">🔗 Open link</a>`;
            }
            document.getElementById('rewardUnlockOverlay').style.display = 'flex';
        }

        window.dismissRewardOverlay = function() {
            document.getElementById('rewardUnlockOverlay').style.display = 'none';
        };

        // ── End Rewards System ────────────────────────────────────────────

        // ── Dimension Level System ────────────────────────────────────────
        //
        // Dimension XP threshold uses half the global scaling factor:
        //   dimXPForLevel(L) = round((k/2) × (2L − 1))
        // This means dimensions level up ~2× faster than the global level.
        //
        // Each dimension stores:
        //   dim.dimLevel     — current level (default 1)
        //   dim.dimXP        — XP within current level (default 0)
        //   dim.dimTotalXP   — cumulative XP ever earned in this dim
        //   dim.dimRewards   — { [level]: { title, description, icon, link } }

        function calculateDimXPForLevel(level) {
            const k = getLevelScaling();
            return Math.max(1, Math.round((k / 2) * (2 * level - 1)));
        }

        // Ensure dim has the required fields (idempotent)
        function initDim(dim) {
            if (!dim.dimLevel)    dim.dimLevel    = 1;
            if (!dim.dimXP)       dim.dimXP       = 0;
            if (!dim.dimTotalXP)  dim.dimTotalXP  = 0;
            if (!dim.dimRewards)  dim.dimRewards  = {};
        }

        // Apply an XP change to a dimension (positive or negative).
        // Returns true if the dimension leveled up (so caller can show toast).
        function applyDimXP(dim, xpChange) {
            initDim(dim);
            dim.dimTotalXP = (dim.dimTotalXP || 0) + xpChange;
            dim.dimXP      = (dim.dimXP      || 0) + xpChange;

            let leveledUp = false;

            // Level-up loop
            while (dim.dimXP >= calculateDimXPForLevel(dim.dimLevel)) {
                dim.dimXP   -= calculateDimXPForLevel(dim.dimLevel);
                dim.dimLevel = (dim.dimLevel || 1) + 1;
                leveledUp    = true;
                // Show reward if one is set for this level
                const reward = (dim.dimRewards || {})[dim.dimLevel];
                if (reward) {
                    setTimeout(() => showDimRewardUnlock(dim, dim.dimLevel), 600);
                } else {
                    showDimLevelUpToast(dim.name, dim.dimLevel);
                }
            }

            // Level-down (negative XP)
            while (dim.dimXP < 0 && dim.dimLevel > 1) {
                dim.dimLevel -= 1;
                dim.dimXP   += calculateDimXPForLevel(dim.dimLevel);
            }
            if (dim.dimXP < 0) dim.dimXP = 0;

            return leveledUp;
        }

        function showDimLevelUpToast(dimName, level) {
            _showToastPill({
                icon: '🗺️',
                label: `${escapeHtml(dimName)} reached Dim Level ${level}!`,
                accent: 'var(--color-accent-olive)',
                accentEnd: '#8a8c55',
                border: 'rgba(122,123,77,0.5)',
            });
        }

        function showDimRewardUnlock(dim, level) {
            const reward = (dim.dimRewards || {})[level];
            if (!reward) return;
            document.getElementById('dimRewardUnlockIcon').textContent  = reward.icon || '🗺️';
            document.getElementById('dimRewardUnlockLevel').textContent = `🎉 ${escapeHtml(dim.name)} — Level ${level}!`;
            document.getElementById('dimRewardUnlockTitle').textContent = reward.title;
            document.getElementById('dimRewardUnlockDesc').textContent  = reward.description || '';
            const descEl = document.getElementById('dimRewardUnlockDesc');
            if (reward.link) {
                descEl.innerHTML += ` <a href="${escapeHtml(reward.link)}" target="_blank" rel="noopener" style="color:var(--color-accent-blue);">🔗 Open link</a>`;
            }
            document.getElementById('dimRewardUnlockOverlay').style.display = 'flex';
        }

        window.dismissDimRewardOverlay = function() {
            document.getElementById('dimRewardUnlockOverlay').style.display = 'none';
        };

        // Find the dimension object that contains a given activity id
        function findDimForActivity(activityId) {
            for (const dim of (window.userData.dimensions || [])) {
                for (const path of (dim.paths || [])) {
                    if ((path.activities || []).some(a => a.id === activityId)) return dim;
                }
            }
            return null;
        }

        // ── Rewards Mode Toggle ───────────────────────────────────────────
        window._rewardMode = 'global';

        window.switchRewardMode = function(mode) {
            window._rewardMode = mode;
            document.getElementById('rewardsGlobalSection').style.display  = mode === 'global'    ? '' : 'none';
            document.getElementById('rewardsDimSection').style.display     = mode === 'dimension' ? '' : 'none';
            document.getElementById('rewardModeGlobal').classList.toggle('active', mode === 'global');
            document.getElementById('rewardModeDim').classList.toggle('active',    mode === 'dimension');
            if (mode === 'dimension') {
                populateDimRewardSelect();
                renderDimRewards();
            }
        };

        function populateDimRewardSelect() {
            const sel = document.getElementById('dimRewardSelect');
            if (!sel) return;
            const dims = window.userData.dimensions || [];
            const current = sel.value;
            sel.innerHTML = '<option value="">— Select a dimension —</option>' +
                dims.map(d => `<option value="${escapeHtml(d.id)}" ${d.id === current ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('');
        }

        window.renderDimRewards = function() {
            var sel = document.getElementById('dimRewardSelect');
            var container = document.getElementById('dimRewardsTimeline');
            if (!sel || !container) return;
            var dimId = sel.value;
            if (!dimId) { container.innerHTML = ''; return; }

            var dim = (window.userData.dimensions || []).find(function(d) { return d.id === dimId; });
            if (!dim) { container.innerHTML = ''; return; }
            initDim(dim);

            var currentLevel = dim.dimLevel || 1;
            var rewards      = dim.dimRewards || {};
            var VISIBLE_FUTURE = 5;

            var levelsWithRewards = Object.keys(rewards).map(Number).filter(function(l) { return l < currentLevel && l >= 2; });
            var startLevel = levelsWithRewards.length > 0 ? Math.min.apply(null, levelsWithRewards) : Math.max(2, currentLevel);
            var endLevel = currentLevel + VISIBLE_FUTURE;

            var levelsToShow = [];
            for (var lvl = Math.max(2, startLevel); lvl <= endLevel; lvl++) levelsToShow.push(lvl);

            // ── "Add reward for any dim level" input row ──────────────────
            var html = '<div class="reward-any-level-row">'
                + '<label>🎯 Set reward for any dim level:</label>'
                + '<input type="number" id="dimRewardAnyLevelInput" min="2" max="200" placeholder="2–200" style="width:90px;">'
                + '<button class="btn-reward-add" onclick="openDimRewardForAnyLevel()">➕ Add / Edit</button>'
                + '</div>';

            levelsToShow.forEach(function(lvl) {
                var reward = rewards[lvl];
                var isUnlocked = lvl < currentLevel;
                var isCurrent  = lvl === currentLevel;
                var nodeClass  = isUnlocked ? 'unlocked' : isCurrent ? 'current' : 'future';
                var statusLabel = isUnlocked ? '\u2713 Unlocked' : isCurrent ? '\u26a1 Current Level' : 'Dim Level ' + lvl;
                var statusBadgeClass = isUnlocked ? 'badge-unlocked' : isCurrent ? 'badge-current' : 'badge-upcoming';

                var rewardContent;
                if (reward) {
                    var iconPart = reward.icon ? escapeHtml(reward.icon) + ' &nbsp;' : '';
                    var descPart = reward.description ? '<div class="reward-desc">' + escapeHtml(reward.description) + '</div>' : '';
                    var linkPart = (reward.link && isUnlocked) ? '<a href="' + escapeHtml(reward.link) + '" target="_blank" rel="noopener" class="btn-reward-claim">\ud83c\udf81 Claim Reward</a>' : '';
                    var editPart = '<button class="btn-reward-edit" onclick="openDimRewardModal(\'' + escapeHtml(dimId) + '\',' + lvl + ')">\u270f\ufe0f Edit</button>'
                        + '<button class="btn-reward-delete" onclick="deleteDimReward(\'' + escapeHtml(dimId) + '\',' + lvl + ')" title="Delete reward">\u2715</button>';
                    rewardContent = '<div class="reward-title">' + iconPart + escapeHtml(reward.title) + '</div>'
                        + descPart
                        + '<div class="reward-card-actions">' + linkPart + editPart + '</div>';
                } else {
                    // Both isCurrent and future future levels get an Add button
                    rewardContent = '<div class="reward-title" style="color:var(--color-text-secondary);font-style:italic;font-weight:400;">No reward set yet</div>'
                        + '<div class="reward-card-actions"><button class="btn-reward-add" onclick="openDimRewardModal(\'' + escapeHtml(dimId) + '\',' + lvl + ')">\u2795 Add reward</button></div>';
                }

                html += '<div class="reward-node ' + nodeClass + '">'
                    + '<div class="reward-node-dot"></div>'
                    + '<div class="reward-card' + (reward ? ' reward-set' : '') + '">'
                    + '<div class="reward-card-header">'
                    + '<span class="reward-level-label">Dim Level ' + lvl + '</span>'
                    + '<span class="reward-status-badge ' + statusBadgeClass + '">' + statusLabel + '</span>'
                    + '</div>'
                    + rewardContent
                    + '</div></div>';
            });
            container.innerHTML = html;
        };

        let _editingDimRewardDimId  = null;
        let _editingDimRewardLevel  = null;

        window.openDimRewardModal = function(dimId, level) {
            _editingDimRewardDimId = dimId;
            _editingDimRewardLevel = level;
            const dim = (window.userData.dimensions || []).find(d => d.id === dimId);
            const label = dim ? `${dim.name} — Dim Level` : 'Dim Level';
            document.getElementById('rewardModalTitle').innerHTML = `Set Reward for <span id="rewardModalLevel">${label} ${level}</span>`;
            // Reuse the existing reward modal — tag it as dim mode
            document.getElementById('rewardModal')._dimMode = true;
            const existing = dim && (dim.dimRewards || {})[level];
            document.getElementById('rewardTitle').value       = existing ? existing.title       : '';
            document.getElementById('rewardDescription').value = existing ? existing.description : '';
            document.getElementById('rewardLink').value        = existing ? existing.link        : '';
            document.getElementById('rewardIcon').value        = existing ? existing.icon        : '';
            document.getElementById('rewardModal').classList.add('active');
        };

        // ── Patch saveReward to support both global and dim modes ─────────
        // (original saveReward is replaced below)

        window.deleteDimReward = async function(dimId, level) {
            if (!confirm('Delete the reward for Dim Level ' + level + '?')) return;
            var dim = (window.userData.dimensions || []).find(function(d) { return d.id === dimId; });
            if (dim && dim.dimRewards) {
                delete dim.dimRewards[level];
                await saveUserData();
                renderDimRewards();
                showToast('Reward deleted', 'red');
            }
        };

        // ── Dimension Progress in Analytics ───────────────────────────────
        window.renderDimProgress = function renderDimProgress() {
            try {
                var el = document.getElementById('dimProgressList');
                if (!el) return;
                var dims = (window.userData && window.userData.dimensions) ? window.userData.dimensions : [];
                if (!dims.length) {
                    el.innerHTML = '<p style="color:var(--color-text-secondary);font-size:13px;text-align:center;padding:16px 0;">No dimensions yet. Create a dimension to track progress here.</p>';
                    return;
                }
                var html = '';
                for (var di = 0; di < dims.length; di++) {
                    var dim = dims[di];
                    if (!dim) continue;
                    if (!dim.dimLevel)   dim.dimLevel   = 1;
                    if (!dim.dimXP)      dim.dimXP      = 0;
                    if (!dim.dimRewards) dim.dimRewards = {};
                    if (!dim.dimTotalXP) {
                        var reconstructed = 0;
                        var rpaths = dim.paths || [];
                        for (var rpi = 0; rpi < rpaths.length; rpi++) {
                            var racts = rpaths[rpi].activities || [];
                            for (var rai = 0; rai < racts.length; rai++) {
                                var rhist = racts[rai].completionHistory || [];
                                for (var rhi = 0; rhi < rhist.length; rhi++) {
                                    if (!rhist[rhi].isPenalty) reconstructed += (rhist[rhi].xp || 0);
                                }
                            }
                        }
                        if (reconstructed > 0) {
                            dim.dimTotalXP = reconstructed;
                            var k = getLevelScaling();
                            var dLevel = 1, dXP = reconstructed;
                            while (dXP >= Math.max(1, Math.round((k / 2) * (2 * dLevel - 1))) && dLevel < 200) {
                                dXP -= Math.max(1, Math.round((k / 2) * (2 * dLevel - 1)));
                                dLevel++;
                            }
                            dim.dimLevel = dLevel;
                            dim.dimXP    = Math.max(0, dXP);
                        }
                    }
                    var level     = dim.dimLevel || 1;
                    var currentXP = dim.dimXP    || 0;
                    var needed    = calculateDimXPForLevel(level);
                    var pct       = needed > 0 ? Math.min(100, (currentXP / needed) * 100) : 0;
                    var reward    = dim.dimRewards[level + 1];
                    var totalActs = 0;
                    var paths2 = dim.paths || [];
                    for (var pi2 = 0; pi2 < paths2.length; pi2++) totalActs += (paths2[pi2].activities || []).length;
                    var totalDimXP = dim.dimTotalXP || 0;
                    var noun = totalActs === 1 ? 'activity' : 'activities';
                    var safe = function(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
                    var rewardHtml = (reward && reward.title)
                        ? '<div class="dim-reward-notice">Next reward at Lv ' + (level+1) + ': ' + safe(reward.title) + '</div>'
                        : '';
                    html += '<div class="dim-progress-card">'
                        + '<div class="dim-progress-header">'
                        +   '<span class="dim-level-badge">Lv ' + level + '</span>'
                        +   '<span class="dim-progress-name">' + safe(dim.name || 'Unnamed') + '</span>';
                    var dimCat = window.LIFE_CATEGORIES && window.LIFE_CATEGORIES.find(function(c){ return c.id === dim.lifeCategory; });
                    if (dimCat) {
                        var rgb = _hexToRgbStr(dimCat.color);
                        html += '<span class="dim-cat-pill" style="background:rgba(' + rgb + ',0.12);color:' + dimCat.color + ';border:1px solid rgba(' + rgb + ',0.3);">' + dimCat.emoji + ' ' + safe(dimCat.label) + '</span>';
                    }
                    html +=     '<span class="dim-progress-xp">' + currentXP + ' / ' + needed + ' XP</span>'
                        + '</div>'
                        + '<div class="dim-progress-bar-track">'
                        +   '<div class="dim-progress-bar-fill" style="width:' + pct.toFixed(1) + '%;"></div>'
                        + '</div>'
                        + '<div style="display:flex;justify-content:space-between;margin-top:6px;font-size:11px;color:var(--color-text-secondary);">'
                        +   '<span>' + totalActs + ' ' + noun + ' &middot; ' + totalDimXP.toLocaleString() + ' total XP</span>'
                        +   '<span>' + pct.toFixed(0) + '% to Lv ' + (level+1) + '</span>'
                        + '</div>'
                        + rewardHtml
                        + '</div>';
                }
                el.innerHTML = html || '<p style="color:var(--color-text-secondary);font-size:13px;text-align:center;padding:16px 0;">No dimensions yet.</p>';
            } catch(err) {
                console.error('[renderDimProgress] error:', err);
                var el2 = document.getElementById('dimProgressList');
                if (el2) el2.innerHTML = '<p style="color:red;font-size:12px;padding:8px;">Error rendering. Check console.</p>';
            }
        };


        // ── Analytics System ──────────────────────────────────────────────

        // State
        window.analyticsState = {
            view: 'all',       // all | dimension | path | activity
            period: 'all',     // 7d | 30d | all
            dimId: null,
            pathId: null,
            activityId: null,
            chartMode: 'cumulative',  // cumulative | daily
        };
        window.calendarOffset = 0; // months relative to current
        window.xpChartInstance = null;

        // ── Helpers ──────────────────────────────────────────────────────

        function getAllActivitiesFlat() {
            const result = [];
            (window.userData.dimensions || []).forEach(dim => {
                (dim.paths || []).forEach(path => {
                    (path.activities || []).forEach(act => {
                        result.push({ ...act, dimId: dim.id, dimName: dim.name, pathId: path.id, pathName: path.name });
                    });
                });
            });
            return result;
        }

        function parseCompletionDates(activity) {
            // We store lastCompleted; we also need the full history.
            // Since full history isn't stored, we derive a synthetic list from completionCount + lastCompleted
            // for the calendar. Full history would require a separate log — we'll use what we have.
            const dates = [];
            if (activity.lastCompleted) dates.push(new Date(activity.lastCompleted));
            return dates;
        }

        // Build a proper completion event log from stored history arrays (if present) or fallback
        function getCompletionLog(activities) {
            const log = []; // { date, activityId, activityName, xp, dimName, pathName }
            activities.forEach(act => {
                // Use completionHistory if present (we'll start recording it going forward)
                if (act.completionHistory && act.completionHistory.length) {
                    act.completionHistory.forEach(entry => {
                        log.push({
                            date: new Date(entry.date),
                            activityId: act.id,
                            activityName: act.name,
                            xp: entry.xp || act.baseXP,
                            dimName: act.dimName,
                            pathName: act.pathName,
                        });
                    });
                } else if (act.lastCompleted) {
                    // Fallback: synthetic single entry
                    log.push({
                        date: new Date(act.lastCompleted),
                        activityId: act.id,
                        activityName: act.name,
                        xp: act.totalXP || act.baseXP,
                        dimName: act.dimName,
                        pathName: act.pathName,
                    });
                }
            });
            return log.sort((a, b) => a.date - b.date);
        }

        function filterByPeriod(log, period) {
            if (period === 'all') return log;
            const cutoff = new Date();
            if (period === '7d')  cutoff.setDate(cutoff.getDate() - 7);
            if (period === '30d') cutoff.setDate(cutoff.getDate() - 30);
            return log.filter(e => e.date >= cutoff);
        }

        function filterByScope(activities, state) {
            if (state.view === 'dimension' && state.dimId) {
                activities = activities.filter(a => a.dimId === state.dimId);
            } else if (state.view === 'path' && state.pathId) {
                activities = activities.filter(a => a.pathId === state.pathId);
            } else if (state.view === 'activity' && state.activityId) {
                activities = activities.filter(a => a.id === state.activityId);
            }
            return activities;
        }

        // ── Filter UI ─────────────────────────────────────────────────────

        window.setAnalyticsFilter = function(key, val, btn) {
            window.analyticsState[key] = val;
            // Update pill active states within parent
            const parent = btn.closest('.filter-pills');
            parent.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            // Show/hide scope dropdowns
            const view = window.analyticsState.view;
            document.getElementById('filterDimGroup').style.display    = (view === 'dimension' || view === 'path' || view === 'activity') ? 'flex' : 'none';
            document.getElementById('filterPathGroup').style.display   = (view === 'path' || view === 'activity') ? 'flex' : 'none';
            document.getElementById('filterActivityGroup').style.display = (view === 'activity') ? 'flex' : 'none';
            populateFilterDropdowns();
            renderAnalytics();
        };

        function populateFilterDropdowns() {
            const dims = window.userData.dimensions || [];
            const dimSel = document.getElementById('filterDimSelect');
            const selectedDim = window.analyticsState.dimId || (dims[0] ? dims[0].id : '');
            dimSel.innerHTML = dims.map(d => `<option value="${d.id}" ${d.id===selectedDim?'selected':''}>${escapeHtml(d.name)}</option>`).join('');
            window.analyticsState.dimId = selectedDim;

            const dim = dims.find(d => d.id === selectedDim);
            const paths = dim ? (dim.paths || []) : [];
            const pathSel = document.getElementById('filterPathSelect');
            const selectedPath = window.analyticsState.pathId || (paths[0] ? paths[0].id : '');
            pathSel.innerHTML = paths.map(p => `<option value="${p.id}" ${p.id===selectedPath?'selected':''}>${escapeHtml(p.name)}</option>`).join('');
            window.analyticsState.pathId = selectedPath;

            const path = paths.find(p => p.id === selectedPath);
            const acts = path ? (path.activities || []) : [];
            const actSel = document.getElementById('filterActivitySelect');
            const selectedAct = window.analyticsState.activityId || (acts[0] ? acts[0].id : '');
            actSel.innerHTML = acts.map(a => `<option value="${a.id}" ${a.id===selectedAct?'selected':''}>${escapeHtml(a.name)}</option>`).join('');
            window.analyticsState.activityId = selectedAct;
        }

        window.applyAnalyticsFilters = function() {
            window.analyticsState.dimId      = document.getElementById('filterDimSelect').value;
            window.analyticsState.pathId     = document.getElementById('filterPathSelect').value;
            window.analyticsState.activityId = document.getElementById('filterActivitySelect').value;
            // Re-populate path/activity when dim changes
            populateFilterDropdowns();
            renderAnalytics();
        };

        window.setChartMode = function(mode, btn) {
            window.analyticsState.chartMode = mode;
            const parent = btn.closest('.filter-pills');
            parent.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            renderXPChart(window._analyticsLog);
        };

        // ── Life Spider Chart ─────────────────────────────────────────────
        // Draws a pentagon radar chart onto #lifespiderCanvas.
        // Each axis = one of the 5 life categories.
        // Data point on each axis = categoryXP[id] / maxCategoryXP (0–1 ratio).
        // Raw XP labels are shown at each data point so the chart is numerically precise.

        function renderLifeSpiderChart() {
            const container = document.getElementById('lifespiderContainer');
            if (!container) return;

            const catXP = getCategoryXP();
            const cats  = window.LIFE_CATEGORIES;

            // Need at least 2 categories with XP to draw something meaningful
            const filledCount = cats.filter(c => catXP[c.id] > 0).length;
            if (filledCount < 1) {
                container.innerHTML = `
                    <div class="spider-empty">
                        <div style="font-size:32px;margin-bottom:10px;">🕸️</div>
                        <p style="font-weight:600;color:var(--color-text-primary);margin-bottom:6px;">No category data yet</p>
                        <p>Go to <strong>Dimensions</strong>, edit each dimension and assign it a Life Category (Body, Mind, Work, People, Extra). The chart will fill in as you complete activities.</p>
                    </div>`;
                return;
            }

            const totalCatXP = Object.values(catXP).reduce((s, v) => s + v, 0);
            const maxXP = Math.max(...cats.map(c => catXP[c.id]), 1);

            // Canvas sizing
            const DPR  = window.devicePixelRatio || 1;
            const SIZE = Math.min(container.clientWidth || 340, 380);
            let canvas = container.querySelector('canvas.spider-canvas');
            if (!canvas) {
                canvas = document.createElement('canvas');
                canvas.className = 'spider-canvas';
                canvas.style.cssText = 'display:block;width:100%;max-width:380px;margin:0 auto;';
                container.innerHTML = '';
                container.appendChild(canvas);
                // Legend below canvas
                const legend = document.createElement('div');
                legend.id = 'spiderLegend';
                legend.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px 16px;justify-content:center;margin-top:16px;';
                container.appendChild(legend);
            }

            const W = SIZE * DPR, H = SIZE * DPR;
            canvas.width  = W;
            canvas.height = H;
            canvas.style.width  = SIZE + 'px';
            canvas.style.height = SIZE + 'px';

            const ctx = canvas.getContext('2d');
            ctx.scale(DPR, DPR);
            ctx.clearRect(0, 0, SIZE, SIZE);

            const cx = SIZE / 2, cy = SIZE / 2;
            const N  = cats.length; // 5
            const R  = SIZE * 0.34; // outer radius of chart polygon
            const labelR = SIZE * 0.46; // radius where labels sit

            // Angle for each axis — start from top (−90°), go clockwise
            function axisAngle(i) { return (Math.PI * 2 / N) * i - Math.PI / 2; }

            // Point on axis at ratio r (0–1)
            function axisPoint(i, r) {
                const a = axisAngle(i);
                return { x: cx + Math.cos(a) * R * r, y: cy + Math.sin(a) * R * r };
            }

            const root = getComputedStyle(document.documentElement);
            const borderColor   = root.getPropertyValue('--color-border').trim()          || '#3a3a3a';
            const textSecondary = root.getPropertyValue('--color-text-secondary').trim()  || '#b0b0b0';
            const uAccent       = root.getPropertyValue('--color-accent-blue').trim()     || '#4a7c9e';
            const uProgress     = root.getPropertyValue('--color-progress').trim()        || '#5a9fd4';

            // ── Grid rings (5 concentric) ──
            for (let ring = 1; ring <= 5; ring++) {
                const ratio = ring / 5;
                ctx.beginPath();
                for (let i = 0; i < N; i++) {
                    const p = axisPoint(i, ratio);
                    i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
                }
                ctx.closePath();
                ctx.strokeStyle = borderColor;
                ctx.globalAlpha = ring === 5 ? 0.5 : 0.2;
                ctx.lineWidth   = ring === 5 ? 1 : 0.5;
                ctx.stroke();
                ctx.globalAlpha = 1;
            }

            // ── Axis spokes ──
            for (let i = 0; i < N; i++) {
                const outer = axisPoint(i, 1);
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(outer.x, outer.y);
                ctx.strokeStyle = borderColor;
                ctx.globalAlpha = 0.3;
                ctx.lineWidth   = 0.5;
                ctx.stroke();
                ctx.globalAlpha = 1;
            }

            // ── Data polygon ──
            const dataPoints = cats.map((c, i) => axisPoint(i, catXP[c.id] > 0 ? catXP[c.id] / maxXP : 0.01));

            // Fill
            ctx.beginPath();
            dataPoints.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
            ctx.closePath();
            const fillGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
            fillGrad.addColorStop(0,   `rgba(${_hexToRgbStr(uProgress)}, 0.25)`);
            fillGrad.addColorStop(0.7, `rgba(${_hexToRgbStr(uAccent)},   0.15)`);
            fillGrad.addColorStop(1,   `rgba(${_hexToRgbStr(uAccent)},   0.05)`);
            ctx.fillStyle   = fillGrad;
            ctx.fill();

            // Stroke
            ctx.beginPath();
            dataPoints.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
            ctx.closePath();
            ctx.strokeStyle = uProgress;
            ctx.globalAlpha = 0.8;
            ctx.lineWidth   = 1.5;
            ctx.lineJoin    = 'round';
            ctx.stroke();
            ctx.globalAlpha = 1;

            // ── Data point dots + XP labels ──
            cats.forEach((cat, i) => {
                const xp   = catXP[cat.id];
                const r    = xp > 0 ? xp / maxXP : 0.01;
                const dp   = axisPoint(i, r);
                const lp   = axisPoint(i, 1.13);  // label sits just outside outer ring
                const angle = axisAngle(i);

                // Dot
                ctx.beginPath();
                ctx.arc(dp.x, dp.y, xp > 0 ? 5 : 3, 0, Math.PI * 2);
                ctx.fillStyle   = xp > 0 ? cat.color : borderColor;
                ctx.globalAlpha = xp > 0 ? 1 : 0.3;
                ctx.fill();
                ctx.globalAlpha = 1;

                // Axis label (emoji + name)
                const fontSize = Math.max(11, Math.round(SIZE * 0.038));
                ctx.font        = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
                ctx.textAlign   = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle   = xp > 0 ? cat.color : textSecondary;
                ctx.globalAlpha = xp > 0 ? 1 : 0.4;
                ctx.fillText(`${cat.emoji} ${cat.label}`, lp.x, lp.y);
                ctx.globalAlpha = 1;

                // XP value label (only if > 0)
                if (xp > 0) {
                    const xpLabel = xp >= 1000 ? (xp / 1000).toFixed(1) + 'k' : String(xp);
                    const xpFontSize = Math.max(9, Math.round(SIZE * 0.03));
                    ctx.font        = `400 ${xpFontSize}px system-ui, sans-serif`;
                    ctx.fillStyle   = textSecondary;
                    ctx.globalAlpha = 0.8;
                    // Offset the XP label slightly inward from the axis label
                    const xpR  = Math.min(r + 0.12, 0.95);
                    const xpPt = axisPoint(i, xpR > r ? r - 0.08 : r + 0.08);
                    // Position slightly offset perpendicular to keep readable
                    const perpX = -Math.sin(angle) * 14;
                    const perpY =  Math.cos(angle) * 14;
                    ctx.fillText(xpLabel, dp.x + perpX, dp.y + perpY);
                    ctx.globalAlpha = 1;
                }
            });

            // ── Legend (below canvas) ──
            const legendEl = document.getElementById('spiderLegend');
            if (legendEl) {
                legendEl.innerHTML = cats.map(c => {
                    const xp  = catXP[c.id];
                    const pct = totalCatXP > 0 ? Math.round(xp / totalCatXP * 100) : 0;
                    return `<span class="spider-legend-item" style="color:${xp > 0 ? c.color : textSecondary};opacity:${xp > 0 ? 1 : 0.4};">
                        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${xp > 0 ? c.color : borderColor};margin-right:4px;vertical-align:middle;"></span>
                        ${c.emoji} ${c.label}
                        ${xp > 0 ? `<span style="color:${textSecondary};font-weight:400;">&nbsp;${xp.toLocaleString()} XP · ${pct}%</span>` : '<span style="color:'+textSecondary+';font-weight:400;opacity:0.5;"> no data</span>'}
                    </span>`;
                }).join('');
            }
        }

        // Re-render spider chart when window resizes (responsive)
        window.addEventListener('resize', function() {
            if (window.currentTab === 'analytics') {
                try { renderLifeSpiderChart(); } catch(e) {}
            }
        });

        // ── Main Render ──────────────────────────────────────────────────

        function renderAnalytics() {
            var allActs, filtered, fullLog, log;
            try { allActs  = getAllActivitiesFlat(); } catch(e) { allActs = []; console.warn('getAllActivitiesFlat', e); }
            try { filtered = filterByScope(allActs, window.analyticsState); } catch(e) { filtered = allActs; }
            try { fullLog  = getCompletionLog(filtered); } catch(e) { fullLog = []; console.warn('getCompletionLog', e); }
            try { log      = filterByPeriod(fullLog, window.analyticsState.period); } catch(e) { log = fullLog; }
            window._analyticsLog = log;

            try { renderAnalyticsSummary(filtered, log); } catch(e) { console.warn('renderAnalyticsSummary', e); }
            try { renderXPChart(log); }                   catch(e) { console.warn('renderXPChart', e); }
            try { renderXPLeaderboard(filtered, log); }   catch(e) { console.warn('renderXPLeaderboard', e); }
            try { renderStreakBoard(filtered); }           catch(e) { console.warn('renderStreakBoard', e); }
            try { renderFrequencyChart(filtered, log); }  catch(e) { console.warn('renderFrequencyChart', e); }
            try { renderCombosPanel(log); }               catch(e) { console.warn('renderCombosPanel', e); }
            try { renderCalendar(); }                     catch(e) { console.warn('renderCalendar', e); }
            try { renderTimeOfDay(log); }                 catch(e) { console.warn('renderTimeOfDay', e); }
            try { renderDimProgress(); }                  catch(e) { console.warn('renderDimProgress outer', e); }
            try { renderLifeSpiderChart(); }              catch(e) { console.warn('renderLifeSpiderChart', e); }
            try { renderActivityHistory(); }              catch(e) { console.warn('renderActivityHistory', e); }
        }

        // ── Summary Cards ────────────────────────────────────────────────

        function renderAnalyticsSummary(activities, log) {
            const totalXP = activities.reduce((s, a) => {
                const hist = a.completionHistory || [];
                return s + hist.reduce((hs, e) => hs + (e.xp || 0), 0);
            }, 0) + (window.userData.xpDeletedGhost || 0);
            const totalCompletions = activities.reduce((s, a) => s + (a.completionCount || 0), 0);
            const maxStreak = activities.reduce((s, a) => Math.max(s, a.streak || 0), 0);
            const activeCount = activities.filter(a => a.completionCount > 0).length;
            const el = document.getElementById('analyticsSummary');
            el.innerHTML = [
                { v: totalXP.toLocaleString(), l: 'Total XP Earned' },
                { v: totalCompletions.toLocaleString(), l: 'Completions' },
                { v: activities.length, l: 'Activities' },
                { v: activeCount, l: 'Active Activities' },
                { v: maxStreak, l: 'Best Streak' },
            ].map(s => `
                <div class="analytics-stat">
                    <div class="analytics-stat-value">${s.v}</div>
                    <div class="analytics-stat-label">${s.l}</div>
                </div>`).join('');
        }

        // ── XP Over Time Chart (pure SVG — no external lib needed) ──────

        function renderXPChart(log) {
            const container = document.querySelector('.chart-container');
            const empty = document.getElementById('xpChartEmpty');
            const canvas = document.getElementById('xpChart');

            if (!log || log.length === 0) {
                canvas.style.display = 'none';
                empty.style.display = 'flex';
                return;
            }
            empty.style.display = 'none';
            canvas.style.display = 'block';

            const mode = window.analyticsState.chartMode;
            const ctx = canvas.getContext('2d');
            // offsetWidth/Height are 0 when the Analytics tab is not yet visible.
            // getBoundingClientRect gives a reliable size after first layout.
            const _rect = canvas.getBoundingClientRect();
            const W = (_rect.width  > 0 ? _rect.width  : canvas.offsetWidth)  || 600;
            const H = (_rect.height > 0 ? _rect.height : canvas.offsetHeight) || 220;
            canvas.width = W;
            canvas.height = H;

            // Build data points
            let points = [];
            if (mode === 'cumulative') {
                let cum = 0;
                log.forEach(e => {
                    cum += e.xp;
                    points.push({ date: e.date, val: cum });
                });
            } else {
                // Daily totals
                const byDay = {};
                log.forEach(e => {
                    const k = e.date.toISOString().split('T')[0];
                    byDay[k] = (byDay[k] || 0) + e.xp;
                });
                const keys = Object.keys(byDay).sort();
                keys.forEach(k => points.push({ date: new Date(k), val: byDay[k] }));
            }

            if (points.length === 0) { canvas.style.display='none'; empty.style.display='flex'; return; }

            const pad = { top: 20, right: 20, bottom: 36, left: 52 };
            const cW = W - pad.left - pad.right;
            const cH = H - pad.top - pad.bottom;

            const minDate = points[0].date.getTime();
            const maxDate = points[points.length-1].date.getTime();
            const maxVal  = Math.max(...points.map(p => p.val)) || 1;
            const dateRange = maxDate - minDate || 1;

            const px = d => pad.left + ((d.getTime() - minDate) / dateRange) * cW;
            const py = v => pad.top + cH - (v / maxVal) * cH;

            ctx.clearRect(0, 0, W, H);

            // Grid lines
            ctx.strokeStyle = 'rgba(255,255,255,0.05)';
            ctx.lineWidth = 1;
            for (let i = 0; i <= 4; i++) {
                const y = pad.top + (cH / 4) * i;
                ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y); ctx.stroke();
                const label = Math.round(maxVal * (4-i) / 4);
                ctx.fillStyle = 'rgba(176,176,176,0.7)';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(label >= 1000 ? (label/1000).toFixed(1)+'k' : label, pad.left - 6, y + 4);
            }

            // Fill gradient
            const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
            grad.addColorStop(0, 'rgba(74,124,158,0.45)');
            grad.addColorStop(1, 'rgba(74,124,158,0)');
            ctx.beginPath();
            ctx.moveTo(px(points[0].date), py(points[0].val));
            points.forEach(p => ctx.lineTo(px(p.date), py(p.val)));
            ctx.lineTo(px(points[points.length-1].date), pad.top + cH);
            ctx.lineTo(px(points[0].date), pad.top + cH);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();

            // Line
            ctx.beginPath();
            ctx.moveTo(px(points[0].date), py(points[0].val));
            points.forEach(p => ctx.lineTo(px(p.date), py(p.val)));
            ctx.strokeStyle = '#5a9fd4';
            ctx.lineWidth = 2.5;
            ctx.lineJoin = 'round';
            ctx.stroke();

            // Dots
            points.forEach(p => {
                ctx.beginPath();
                ctx.arc(px(p.date), py(p.val), 3.5, 0, Math.PI * 2);
                ctx.fillStyle = '#5a9fd4';
                ctx.fill();
            });

            // X-axis labels — smart, deduplicated, no overlap
            ctx.fillStyle = 'rgba(176,176,176,0.7)';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';

            const formatDate = d => {
                const mo = d.getMonth() + 1;
                const dy = d.getDate();
                return `${mo}/${dy}`;
            };

            if (points.length === 1) {
                // Single point — just label it centered
                ctx.fillText(formatDate(points[0].date), px(points[0].date), H - 8);
            } else {
                // Pick up to 6 evenly-spaced label positions, always include first and last
                const maxLabels = Math.min(6, points.length);
                const labelIndices = new Set([0, points.length - 1]);
                if (maxLabels > 2) {
                    const step = (points.length - 1) / (maxLabels - 1);
                    for (let i = 1; i < maxLabels - 1; i++) {
                        labelIndices.add(Math.round(i * step));
                    }
                }
                const minPixelGap = 40;
                let lastLabelX = -Infinity;
                [...labelIndices].sort((a,b)=>a-b).forEach(i => {
                    const p = points[i];
                    const x = px(p.date);
                    if (x - lastLabelX >= minPixelGap) {
                        ctx.fillText(formatDate(p.date), x, H - 8);
                        lastLabelX = x;
                    }
                });
            }
        }

        // ── XP Leaderboard ───────────────────────────────────────────────

        function renderXPLeaderboard(activities, log) {
            const el = document.getElementById('xpLeaderboard');
            // Sum XP per activity from log
            const xpMap = {};
            log.forEach(e => { xpMap[e.activityId] = (xpMap[e.activityId] || 0) + e.xp; });
            // Fallback to totalXP if log is sparse
            activities.forEach(a => {
                if (!xpMap[a.id] && a.totalXP) xpMap[a.id] = a.totalXP;
            });
            const ranked = activities
                .filter(a => xpMap[a.id])
                .sort((a,b) => (xpMap[b.id]||0) - (xpMap[a.id]||0))
                .slice(0, 8);
            if (ranked.length === 0) { el.innerHTML = '<div class="empty-state" style="padding:24px 0"><p>No data yet</p></div>'; return; }
            const max = xpMap[ranked[0].id] || 1;
            const colors = ['#5a9fd4','#4a7c9e','#6b7c3f','#7a7b4d','#8e3b5f'];
            el.innerHTML = ranked.map((a, i) => `
                <div class="rank-row">
                    <span class="rank-num">#${i+1}</span>
                    <span class="rank-label" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</span>
                    <div class="rank-bar-track">
                        <div class="rank-bar-fill" style="width:${((xpMap[a.id]||0)/max*100).toFixed(1)}%;background:${colors[i%colors.length]};"></div>
                    </div>
                    <span class="rank-value">${(xpMap[a.id]||0).toLocaleString()} XP</span>
                </div>`).join('');
        }

        // ── Streak Board ─────────────────────────────────────────────────

        function renderStreakBoard(activities) {
            const el = document.getElementById('streakBoard');
            const ranked = [...activities].sort((a,b)=>(b.streak||0)-(a.streak||0)).slice(0,8);
            if (!ranked.some(a => a.streak > 0)) { el.innerHTML = '<div class="empty-state" style="padding:24px 0"><p>No streaks yet</p></div>'; return; }
            const max = ranked[0].streak || 1;
            el.innerHTML = ranked.filter(a=>a.streak>0).map((a,i) => `
                <div class="rank-row">
                    <span class="rank-num">${a.streak >= 30 ? '🔥' : a.streak >= 10 ? '⚡' : `#${i+1}`}</span>
                    <span class="rank-label" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</span>
                    <div class="rank-bar-track">
                        <div class="rank-bar-fill" style="width:${((a.streak||0)/max*100).toFixed(1)}%;background:var(--color-accent-olive);"></div>
                    </div>
                    <span class="rank-value">${a.streak} 🔥</span>
                </div>`).join('');
        }

        // ── Frequency Chart ──────────────────────────────────────────────

        function renderFrequencyChart(activities, log) {
            const el = document.getElementById('frequencyChart');
            // Only count entries in the log (completionHistory after undo removes them)
            const countMap = {};
            log.forEach(e => { countMap[e.activityId] = (countMap[e.activityId]||0) + 1; });
            // Do NOT fall back to completionCount — it can include undone completions
            const ranked = activities
                .filter(a => countMap[a.id] > 0)
                .sort((a,b) => (countMap[b.id]||0)-(countMap[a.id]||0));
            if (ranked.length === 0) { el.innerHTML = '<div class="empty-state" style="padding:24px 0"><p>No data yet</p></div>'; return; }
            const max = countMap[ranked[0].id] || 1;
            const COLORS = {most:'var(--color-accent-green)', least:'var(--color-accent-red)', mid:'var(--color-accent-blue)'};
            el.innerHTML = ranked.map((a,i) => {
                const color = i === 0 ? COLORS.most : i === ranked.length-1 ? COLORS.least : COLORS.mid;
                const tag = i === 0 ? ' 👑' : i === ranked.length-1 ? ' 🐢' : '';
                return `<div class="rank-row">
                    <span class="rank-label" style="width:130px;" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}${tag}</span>
                    <div class="rank-bar-track">
                        <div class="rank-bar-fill" style="width:${((countMap[a.id]||0)/max*100).toFixed(1)}%;background:${color};"></div>
                    </div>
                    <span class="rank-value">${countMap[a.id]||0}×</span>
                </div>`;}).join('');
        }

        // ── Activity Combos ───────────────────────────────────────────────

        function renderCombosPanel(log) {
            const el = document.getElementById('combosPanel');
            // Group completions by day
            const byDay = {};
            log.forEach(e => {
                const k = e.date.toISOString().split('T')[0];
                if (!byDay[k]) byDay[k] = [];
                byDay[k].push(e.activityName);
            });
            const pairs = {};
            Object.values(byDay).forEach(names => {
                const uniq = [...new Set(names)];
                for (let i = 0; i < uniq.length; i++) {
                    for (let j = i+1; j < uniq.length; j++) {
                        const key = [uniq[i], uniq[j]].sort().join(' + ');
                        pairs[key] = (pairs[key]||0)+1;
                    }
                }
            });
            const sorted = Object.entries(pairs).sort((a,b)=>b[1]-a[1]).slice(0,6);
            if (sorted.length === 0) { el.innerHTML = '<div class="empty-state" style="padding:24px 0"><p>Complete multiple activities on the same day to see pairs</p></div>'; return; }
            el.innerHTML = sorted.map(([pair, count]) => {
                const parts = pair.split(' + ');
                return `<div class="combo-row">
                    <div class="combo-names">
                        <span class="combo-chip" title="${escapeHtml(parts[0])}">${escapeHtml(parts[0])}</span>
                        <span class="combo-sep">+</span>
                        <span class="combo-chip" title="${escapeHtml(parts[1])}">${escapeHtml(parts[1])}</span>
                    </div>
                    <span class="combo-count">${count}×</span>
                </div>`;}).join('');
        }

        // ── Calendar ─────────────────────────────────────────────────────

        window.calendarNav = function(dir) {
            window.calendarOffset += dir;
            // Save current selection before re-render so month nav can't lose it
            var calSel = document.getElementById('calendarActivityFilter');
            if (calSel && calSel.value) window._calendarSelId = calSel.value;
            renderCalendar();
        };

        function renderCalendar() {
            const allActs   = getAllActivitiesFlat();
            const scopeFiltered = filterByScope(allActs, window.analyticsState);

            // Populate the calendar activity dropdown.
            // Reading calSel.value after setting innerHTML is unreliable in some browsers
            // (it resets to ''). We persist the selection in window._calendarSelId so it
            // survives both innerHTML rebuilds and month navigation.
            if (typeof window._calendarSelId === 'undefined') window._calendarSelId = '';
            const calSel = document.getElementById('calendarActivityFilter');
            if (calSel) {
                calSel.innerHTML = '<option value="">All Activities</option>' +
                    scopeFiltered.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
                calSel.value = window._calendarSelId;
                // If previously selected activity no longer exists in scope, reset
                if (calSel.value !== window._calendarSelId) window._calendarSelId = '';
            }

            // Filter by selected calendar activity
            const selectedCalId = window._calendarSelId;
            const filtered = selectedCalId
                ? scopeFiltered.filter(a => a.id === selectedCalId)
                : scopeFiltered;

            // Build day → [activities completed] map from all time (calendar ignores period filter)
            const dayMap = {};
            filtered.forEach(act => {
                if (act.completionHistory && act.completionHistory.length) {
                    act.completionHistory.forEach(e => {
                        const k = new Date(e.date).toISOString().split('T')[0];
                        if (!dayMap[k]) dayMap[k] = [];
                        dayMap[k].push({ name: act.name, xp: e.xp || act.baseXP });
                    });
                } else if (act.lastCompleted) {
                    const k = new Date(act.lastCompleted).toISOString().split('T')[0];
                    if (!dayMap[k]) dayMap[k] = [];
                    dayMap[k].push({ name: act.name, xp: act.totalXP || act.baseXP });
                }
            });

            const now = new Date();
            const target = new Date(now.getFullYear(), now.getMonth() + window.calendarOffset, 1);
            const year = target.getFullYear();
            const month = target.getMonth();

            document.getElementById('calendarMonthLabel').textContent =
                target.toLocaleString('default', { month: 'long', year: 'numeric' });

            const daysInMonth = new Date(year, month+1, 0).getDate();
            const firstDow = new Date(year, month, 1).getDay(); // 0=Sun
            const todayStr = now.toISOString().split('T')[0];

            const maxCount = Math.max(...Object.values(dayMap).map(v=>v.length), 1);

            let html = '<div class="calendar-month-grid">';
            ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d => {
                html += `<div class="calendar-dow">${d}</div>`;
            });

            // Empty cells before first day
            for (let i = 0; i < firstDow; i++) html += '<div class="calendar-day empty"></div>';

            for (let d = 1; d <= daysInMonth; d++) {
                const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                const entries = dayMap[dateStr] || [];
                const count = entries.length;
                const isToday = dateStr === todayStr;
                const intensity = count > 0 ? 0.2 + (count / maxCount) * 0.75 : 0;
                const bg = count > 0 ? `rgba(74,124,158,${intensity.toFixed(2)})` : '';
                html += `<div class="calendar-day ${count>0?'has-data':''} ${isToday?'today':''}"
                    style="${bg?'background:'+bg+';':''}"
                    ${count>0 ? `onclick="toggleCalTip(this,'${dateStr}',${count})"` : ''}>
                    <span style="font-size:10px;color:${count>0?'#fff':'var(--color-text-secondary)'};">${d}</span>
                    ${count>0 ? `<div class="cal-day-tip" data-date="${dateStr}"></div>` : ''}
                </div>`;
            }
            html += '</div>';
            document.getElementById('calendarGrid').innerHTML = html;
            window._calDayMap = dayMap;
        }

        window.toggleCalTip = function(cell, dateStr, count) {
            // Close any open tip first
            document.querySelectorAll('.calendar-day.tip-open').forEach(function(el) {
                if (el !== cell) el.classList.remove('tip-open');
            });
            const isOpen = cell.classList.toggle('tip-open');
            if (!isOpen) return;
            // Populate tip content
            const tipEl = cell.querySelector('.cal-day-tip');
            if (!tipEl) return;
            const entries = (window._calDayMap || {})[dateStr] || [];
            const names = [...new Set(entries.map(e => e.name))];
            tipEl.innerHTML = '<strong>' + dateStr + '</strong>' +
                names.map(n => '<div class="cal-tip-item">• ' + escapeHtml(n) + '</div>').join('');

            // Reset any inline positioning from a prior open
            tipEl.style.left = '';
            tipEl.style.right = '';
            tipEl.style.top = '';
            tipEl.style.bottom = '';
            tipEl.style.transform = '';

            // After paint, check if the tip overflows the viewport and adjust
            requestAnimationFrame(function() {
                var tipRect  = tipEl.getBoundingClientRect();
                var cellRect = cell.getBoundingClientRect();
                var vw = window.innerWidth;
                var vh = window.innerHeight;

                // ── Vertical: prefer above, fall back to below ──
                if (tipRect.top < 8) {
                    // Not enough room above — open below the cell instead
                    tipEl.style.bottom = 'auto';
                    tipEl.style.top    = 'calc(100% + 8px)';
                } else {
                    tipEl.style.top    = '';
                    tipEl.style.bottom = 'calc(100% + 8px)';
                }

                // ── Horizontal: centre, then clamp to viewport ──
                // Start centred
                tipEl.style.left      = '50%';
                tipEl.style.transform = 'translateX(-50%)';
                tipEl.style.right     = '';

                // Re-measure after setting centre position
                requestAnimationFrame(function() {
                    var r2 = tipEl.getBoundingClientRect();
                    if (r2.right > vw - 8) {
                        // Overflows right → pin to right edge of cell
                        tipEl.style.left      = 'auto';
                        tipEl.style.right     = '0';
                        tipEl.style.transform = 'none';
                    } else if (r2.left < 8) {
                        // Overflows left → pin to left edge of cell
                        tipEl.style.left      = '0';
                        tipEl.style.right     = 'auto';
                        tipEl.style.transform = 'none';
                    }
                });
            });
        };

        // Close calendar tip when clicking outside
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.calendar-day')) {
                document.querySelectorAll('.calendar-day.tip-open').forEach(function(el) {
                    el.classList.remove('tip-open');
                });
            }
        });

        // ── Time of Day ──────────────────────────────────────────────────

        function renderTimeOfDay(log) {
            const el = document.getElementById('timeOfDayChart');
            const buckets = { 'Morning (6–12)': 0, 'Afternoon (12–17)': 0, 'Evening (17–21)': 0, 'Night (21–6)': 0 };
            log.forEach(e => {
                const h = e.date.getHours();
                if (h >= 6 && h < 12)  buckets['Morning (6–12)']++;
                else if (h >= 12 && h < 17) buckets['Afternoon (12–17)']++;
                else if (h >= 17 && h < 21) buckets['Evening (17–21)']++;
                else buckets['Night (21–6)']++;
            });
            const max = Math.max(...Object.values(buckets), 1);
            const colors = ['#5a9fd4','#7a7b4d','#6b7c3f','#4a7c9e'];
            el.innerHTML = Object.entries(buckets).map(([label, count], i) => `
                <div class="tod-row">
                    <span class="tod-label">${label}</span>
                    <div class="tod-bar-track">
                        <div class="tod-bar-fill" style="width:${(count/max*100).toFixed(1)}%;background:${colors[i]};">
                            ${count > 0 ? count : ''}
                        </div>
                    </div>
                    <span class="tod-count">${count}</span>
                </div>`).join('');
        }

        // ── Activity History ─────────────────────────────────────────────

        window._historyFilter = 'all';
        window._historyPage   = 1;
        const HISTORY_PAGE_SIZE = 40;

        window.setHistoryFilter = function(filter, btn) {
            window._historyFilter = filter;
            window._historyPage   = 1;
            document.querySelectorAll('#activityHistoryFilters .filter-pill').forEach(b => b.classList.remove('active'));
            if (btn) btn.classList.add('active');
            var note = document.getElementById('historyPenaltyNote');
            if (note) note.style.display = filter === 'penalty' ? 'block' : 'none';
            renderActivityHistory(true);
        };

        window.loadMoreHistory = function() {
            window._historyPage++;
            renderActivityHistory(false);
        };

        window.toggleDimProgress = function() {
            var body = document.getElementById('dimProgressBody');
            var btn  = document.getElementById('dimProgressToggleBtn');
            if (!body || !btn) return;
            var isOpen = body.classList.toggle('open');
            btn.classList.toggle('open', isOpen);
            if (isOpen) {
                try { renderDimProgress(); } catch(e) {}
                try { renderLifeSpiderChart(); } catch(e) {}
            }
        };

        window.toggleActivityHistory = function() {
            const body = document.getElementById('activityHistoryBody');
            const btn  = document.getElementById('activityHistoryToggleBtn');
            const isOpen = body.classList.toggle('open');
            btn.classList.toggle('open', isOpen);
            if (isOpen) renderActivityHistory(true);
        };

        function renderActivityHistory(reset) {
            const body = document.getElementById('activityHistoryBody');
            if (!body || !body.classList.contains('open')) return;

            // Build a flat log of all history entries across all activities
            const allActs = getAllActivitiesFlat();
            const rawLog = [];
            allActs.forEach(act => {
                (act.completionHistory || []).forEach(e => {
                    rawLog.push({
                        date:      new Date(e.date),
                        xp:        e.xp || 0,
                        isPenalty: !!e.isPenalty,
                        actName:   act.name,
                        dimName:   act.dimName,
                        pathName:  act.pathName,
                    });
                });
            });

            // Newest first
            rawLog.sort((a, b) => b.date - a.date);

            // Filter
            const filter = window._historyFilter || 'all';
            const filtered = rawLog.filter(e => {
                if (filter === 'positive') return e.xp > 0 && !e.isPenalty;
                if (filter === 'negative') return e.xp < 0;
                if (filter === 'penalty')  return e.isPenalty;
                return true; // 'all'
            });

            const page    = window._historyPage || 1;
            const limit   = page * HISTORY_PAGE_SIZE;
            const visible = filtered.slice(0, limit);
            const hasMore = filtered.length > limit;

            const listEl = document.getElementById('activityHistoryList');
            const moreEl = document.getElementById('activityHistoryMore');
            if (!listEl) return;

            if (visible.length === 0) {
                listEl.innerHTML = '<div style="padding:20px 0;text-align:center;color:var(--color-text-secondary);font-size:13px;">No history yet.</div>';
                if (moreEl) moreEl.style.display = 'none';
                return;
            }

            // Group by calendar date for readability
            let lastDateStr = '';
            let html = '';
            visible.forEach(e => {
                const dateStr = e.date.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric', year:'numeric' });
                if (dateStr !== lastDateStr) {
                    html += `<div style="padding:10px 0 4px;font-size:11px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:var(--color-text-secondary);">${dateStr}</div>`;
                    lastDateStr = dateStr;
                }
                const timeStr = e.date.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
                const isPos   = e.xp >= 0;
                const xpLabel = (isPos ? '+' : '') + e.xp + ' XP';
                const xpClass = isPos ? 'pos' : 'neg';
                const tag     = e.isPenalty
                    ? `<span class="ah-tag ah-tag-penalty">⚡ auto-penalty</span>`
                    : (!isPos ? `<span class="ah-tag ah-tag-negative">−habit</span>` : '');
                html += `
                <div class="ah-row">
                    <span class="ah-xp ${xpClass}">${xpLabel}</span>
                    <span class="ah-name" title="${escapeHtml(e.actName)}">${escapeHtml(e.actName)}</span>
                    ${tag}
                    <span class="ah-meta">${timeStr}</span>
                </div>`;
            });

            listEl.innerHTML = html;
            if (moreEl) moreEl.style.display = hasMore ? 'block' : 'none';
        }

        // Hook into completeActivity to record completionHistory
        function recordCompletion(activity, xpEarned, isPenalty) {
            if (!activity.completionHistory) activity.completionHistory = [];
            activity.completionHistory.push({ date: new Date().toISOString(), xp: xpEarned, ...(isPenalty ? { isPenalty: true } : {}) });
            // Keep last 365 entries to avoid Firestore bloat
            if (activity.completionHistory.length > 365) activity.completionHistory.shift();
        }

        // ── End Analytics System ─────────────────────────────────────────

        // ── Write budget management ───────────────────────────────────────────
        // Firestore free tier: 20,000 document writes/day across all users.
        // We fold the daily backup INSIDE the main save (one setDoc, not two).
        // _backupSavedDate gates this so the snapshot is only embedded once per day.
        let _backupSavedDate = null;

        async function saveUserData() {
            if (!window.currentUser) return;
            try {
                const userDocRef = doc(db, 'users', window.currentUser.uid);
                const today = new Date().toISOString().split('T')[0];
                let dataToSave = window.userData;

                // Once per calendar day, embed a backup snapshot inside the same write.
                // Zero extra Firestore writes vs old approach (which called setDoc twice).
                if (_backupSavedDate !== today) {
                    _backupSavedDate = today;
                    try {
                        const snapshot = JSON.parse(JSON.stringify(window.userData));
                        delete snapshot.autoBackup; // prevent nested recursion
                        dataToSave = Object.assign({}, window.userData, {
                            autoBackup: {
                                savedAt: new Date().toISOString(),
                                savedDate: today,
                                data: snapshot
                            }
                        });
                        // Sync in-memory userData so the UI shows the backup date immediately
                        window.userData.autoBackup = dataToSave.autoBackup;
                    } catch(e) {
                        console.warn('Backup snapshot failed, saving without backup:', e);
                    }
                    updateRestoreBackupBtn(today);
                }

                await setDoc(userDocRef, dataToSave);
            } catch (error) {
                console.error('Error saving data:', error);
                alert('Failed to save data. Please try again.');
            }
        }

        // calculateXPForLevel(L) = XP needed to advance FROM level L to level L+1.
        // Formula: round(k × (2L − 1)) where k = userData.settings.levelScaling (default 8.5)
        function getLevelScaling() {
            return parseFloat(window.userData?.settings?.levelScaling || 8.5);
        }
        function calculateXPForLevel(level) {
            return Math.round(getLevelScaling() * (2 * level - 1));
        }

        // ── Activity Search ───────────────────────────────────────────────

        window.openActivitySearch = function() {
            document.getElementById('activitySearchOverlay').style.display = 'flex';
            const input = document.getElementById('activitySearchInput');
            input.value = '';
            renderSearchResults();
            setTimeout(() => input.focus(), 60);
        };

        window.closeActivitySearch = function(e) {
            if (e && e.target !== document.getElementById('activitySearchOverlay')) return;
            document.getElementById('activitySearchOverlay').style.display = 'none';
        };

        window.searchKeyHandler = function(e) {
            if (e.key === 'Escape') document.getElementById('activitySearchOverlay').style.display = 'none';
        };

        window.renderSearchResults = function() {
            const query = (document.getElementById('activitySearchInput').value || '').trim().toLowerCase();
            const results = document.getElementById('activitySearchResults');

            let allActivities = [];
            (window.userData.dimensions || []).forEach((dim, di) =>
                (dim.paths || []).forEach((path, pi) =>
                    (path.activities || []).forEach((act, ai) =>
                        allActivities.push({ ...act, _di: di, _pi: pi, _ai: ai,
                            _dimName: dim.name, _pathName: path.name }))));

            const filtered = query
                ? allActivities.filter(a =>
                    a.name.toLowerCase().includes(query) ||
                    a._dimName.toLowerCase().includes(query) ||
                    a._pathName.toLowerCase().includes(query))
                : allActivities;

            if (filtered.length === 0) {
                results.innerHTML = `<div class="search-empty">${query ? 'No activities match "' + escapeHtml(query) + '"' : 'No activities yet'}</div>`;
                return;
            }

            const freqLabel = { daily:'Daily', occasional:'Occasional', weekly:'Weekly',
                biweekly:'Bi-weekly', monthly:'Monthly', custom:'Custom' };
            const today = new Date().toDateString();

            results.innerHTML = filtered.map(act => {
                const done = isCompletedToday(act);
                const canDo = canCompleteActivity(act) && !done;
                const hasToday = countCompletionsToday(act) > 0;
                const atRisk = !done && act.streak > 0 && (act.frequency === 'daily');
                const statusDot = done
                    ? `<span style="color:var(--color-accent-green);font-size:13px;">✓</span>`
                    : atRisk ? `<span style="font-size:13px;">🔥</span>` : '';

                const completeBtn = canDo
                    ? `<button class="btn-undo-activity" style="background:rgba(107,124,63,0.25);border-color:rgba(107,124,63,0.5);color:#a0c060;padding:5px 10px;font-size:12px;"
                          onclick="searchCompleteActivity(${act._di},${act._pi},${act._ai})">✓ Do</button>`
                    : '';
                const undoBtn = hasToday
                    ? `<button class="btn-undo-activity" style="padding:5px 10px;font-size:12px;"
                          onclick="searchUndoActivity(${act._di},${act._pi},${act._ai})">↩</button>`
                    : '';

                return `<div class="search-result-item">
                    <div style="min-width:0;">
                        <div class="search-result-name">${statusDot} ${escapeHtml(act.name)}</div>
                        <div class="search-result-meta">${escapeHtml(act._dimName)} › ${escapeHtml(act._pathName)} &nbsp;·&nbsp; ${freqLabel[act.frequency]||act.frequency} &nbsp;·&nbsp; ${act.baseXP} XP${act.streak>0?' &nbsp;·&nbsp; 🔥 '+act.streak:''}</div>
                    </div>
                    <div class="search-result-actions">${completeBtn}${undoBtn}</div>
                </div>`;
            }).join('');
        };

        window.searchCompleteActivity = async function(di, pi, ai) {
            await completeActivity(di, pi, ai);
            renderSearchResults();
        };
        window.searchUndoActivity = async function(di, pi, ai) {
            await undoActivity(di, pi, ai);
            renderSearchResults();
        };

        // ── At-risk badge in activity cards ──────────────────────────────
        // See badge-at-risk usage in renderActivityCards (shows after 10pm).

        // ── Streak Milestone Toast ────────────────────────────────────────

        const STREAK_MILESTONES = [7, 14, 30, 60, 100];
        function checkStreakMilestone(activityName, streak) {
            if (!STREAK_MILESTONES.includes(streak)) return;
            const emojis = { 7:'🔥', 14:'⚡', 30:'🌟', 60:'💎', 100:'👑' };
            _showToastPill({
                icon: emojis[streak] || '🔥',
                label: `${streak}-day streak! ${activityName}`,
                accent: 'rgba(90,60,10,0.95)',
                accentEnd: 'rgba(180,120,20,0.95)',
                border: 'rgba(255,180,50,0.5)',
            });
        }

        // ── Animated XP counter ───────────────────────────────────────────
        // Tracks the last displayed value per element id so we always animate from
        // where the number currently sits, not from 0.
        const _counterState = {};
        function animateCounter(id, targetNum, staticText) {
            const el = document.getElementById(id);
            if (!el) return;
            if (staticText !== null && staticText !== undefined) { el.textContent = staticText; return; }

            const from = parseInt(_counterState[id] ?? el.textContent) || 0;
            const to   = targetNum;
            _counterState[id] = to;

            if (from === to) { el.textContent = to; return; }

            const duration = Math.min(600, Math.max(200, Math.abs(to - from) * 2));
            const start = performance.now();
            const dir   = to > from ? 1 : -1;

            function tick(now) {
                const t  = Math.min(1, (now - start) / duration);
                const ease = 1 - Math.pow(1 - t, 3);           // ease-out-cubic
                const val = Math.round(from + (to - from) * ease);
                el.textContent = val;
                if (t < 1 && _counterState[id] === to) requestAnimationFrame(tick);
                else el.textContent = _counterState[id]; // snap to final in case of interruption
            }
            requestAnimationFrame(tick);
        }

        // ── Inject spider chart card + category pill CSS on startup ───────
        (function injectSpiderAndStyles() {
            // CSS for dim-cat-pill and spider chart
            const s = document.createElement('style');
            s.textContent = `
                .dim-cat-pill {
                    display: inline-flex;
                    align-items: center;
                    gap: 3px;
                    padding: 2px 8px;
                    border-radius: 20px;
                    font-size: 11px;
                    font-weight: 600;
                    white-space: nowrap;
                    cursor: default;
                    line-height: 1.5;
                }
                .dim-cat-pill--unset {
                    background: rgba(255,255,255,0.05) !important;
                    color: var(--color-text-secondary) !important;
                    border: 1px dashed var(--color-border) !important;
                    cursor: pointer !important;
                    font-weight: 500;
                }
                .dim-cat-pill--unset:hover {
                    border-color: var(--color-accent-blue) !important;
                    color: var(--color-accent-blue) !important;
                }
                .spider-empty {
                    text-align: center;
                    padding: 28px 20px;
                    color: var(--color-text-secondary);
                    font-size: 13px;
                    line-height: 1.6;
                    max-width: 400px;
                    margin: 0 auto;
                }
                .spider-legend-item {
                    font-size: 12px;
                    font-weight: 600;
                    display: inline-flex;
                    align-items: center;
                    gap: 2px;
                    white-space: nowrap;
                }
            `;
            document.head.appendChild(s);

            // Inject spider chart analytics card into the DOM
            // Placed after dimProgressCard, before activityHistoryCard
            function injectSpiderCard() {
                if (document.getElementById('lifespiderCard')) return;
                const dimCard = document.getElementById('dimProgressCard');
                if (!dimCard) { setTimeout(injectSpiderCard, 300); return; }

                const card = document.createElement('div');
                card.className = 'analytics-card';
                card.id = 'lifespiderCard';
                card.innerHTML = `
                    <div class="analytics-card-header">
                        <h3 class="analytics-card-title">Life Balance</h3>
                        <span style="font-size:12px;color:var(--color-text-secondary);">XP by category</span>
                    </div>
                    <div id="lifespiderContainer" style="min-height:80px;"></div>
                `;
                dimCard.insertAdjacentElement('afterend', card);
            }
            injectSpiderCard();
        })();

        // Tab switching
        window.switchTab = function(tabName) {
            window.currentTab = tabName;
            
            // Update tab buttons
            document.querySelectorAll('.nav-tab').forEach(tab => {
                tab.classList.remove('active');
                if (tab.getAttribute('onclick') === `switchTab('${tabName}')`) {
                    tab.classList.add('active');
                    tab.classList.remove('nav-tab-pop');
                    void tab.offsetWidth; // force reflow to restart animation
                    tab.classList.add('nav-tab-pop');
                    tab.addEventListener('animationend', () => tab.classList.remove('nav-tab-pop'), { once: true });
                }
            });
            
            // Update tab content
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            document.getElementById(tabName + 'Tab').classList.add('active');

            // Render the newly-visible tab (skipped during updateDashboard if not active)
            if (tabName === 'dimensions') renderDimensions();
            else if (tabName === 'challenges') renderChallenges();
            else if (tabName === 'rewards') renderRewards();
            else if (tabName === 'settings') { loadSettings(); }
            else if (tabName === 'analytics') {
                renderAnalytics();
                // Belt-and-suspenders: ensure dim progress renders even if renderAnalytics threw
                setTimeout(function() { try { renderDimProgress(); } catch(e) {} }, 50);
            }
        };

        // ── Install Mindkraft card ────────────────────────────────────────
        window._deferredInstallPrompt = null;
        window.addEventListener('beforeinstallprompt', function(e) {
            e.preventDefault();
            window._deferredInstallPrompt = e;
        });

        // Hide the install card when already running as a standalone PWA
        (function() {
            var isPWA = window.matchMedia('(display-mode: standalone)').matches
                || window.navigator.standalone === true;
            if (isPWA) {
                var card = document.getElementById('installCard');
                if (card) card.style.display = 'none';
            }
        })();

        window.toggleInstallGuide = function() {
            var body    = document.getElementById('installGuideBody');
            var btn     = document.getElementById('installToggleBtn');
            var chevron = document.getElementById('installChevron');
            if (!body) return;
            var isOpen = body.style.display !== 'none';
            body.style.display = isOpen ? 'none' : 'block';
            btn.classList.toggle('open', !isOpen);
            if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
        };

        window.triggerAndroidInstall = function() {
            if (window._deferredInstallPrompt) {
                window._deferredInstallPrompt.prompt();
                window._deferredInstallPrompt.userChoice.then(function(result) {
                    if (result.outcome === 'accepted') {
                        var card = document.getElementById('installCard');
                        if (card) card.style.display = 'none';
                    }
                    window._deferredInstallPrompt = null;
                });
            } else {
                var fallback = document.getElementById('androidInstallFallback');
                var btn = document.getElementById('androidInstallBtn');
                if (fallback) fallback.style.display = 'block';
                if (btn) btn.style.display = 'none';
            }
        };

        window.toggleGuide = function() {
            const body = document.getElementById('guideBody');
            const btn = document.getElementById('guideToggleBtn');
            const isOpen = body.classList.toggle('open');
            btn.classList.toggle('open', isOpen);
        };

        window.toggleLevelScaling = function() {
            const body = document.getElementById('levelScalingBody');
            const btn = document.getElementById('levelScalingToggleBtn');
            const isOpen = body.classList.toggle('open');
            btn.classList.toggle('open', isOpen);
        };

        window.toggleStreakScaling = function() {
            const body = document.getElementById('streakScalingBody');
            const btn  = document.getElementById('streakScalingToggleBtn');
            const isOpen = body.classList.toggle('open');
            btn.classList.toggle('open', isOpen);
        };

        window.previewStreakScaling = function(val) {
            val = parseFloat(val);
            document.getElementById('streakScalingDisplay').textContent = val.toFixed(1);
            const preview = document.getElementById('streakScalingPreview');
            if (!preview) return;
            const samples = [5, 10, 20, 30, 50];
            preview.innerHTML = samples.map(s => {
                const mult = s < 5 ? 1 : +(1 + 0.1 * Math.pow(s, val)).toFixed(2);
                const bar = Math.min(100, ((mult - 1) / 9) * 100);
                return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">'
                    + '<span style="min-width:70px;">Streak ' + s + '</span>'
                    + '<div style="flex:1;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;">'
                    + '<div style="width:' + bar.toFixed(1) + '%;height:100%;background:var(--color-progress);border-radius:2px;"></div></div>'
                    + '<span style="min-width:36px;text-align:right;color:var(--color-text-primary);font-weight:600;">×' + mult + '</span>'
                    + '</div>';
            }).join('');
        };

        window.applyStreakScaling = async function() {
            const slider = document.getElementById('streakScalingSlider');
            if (!slider) return;
            const newE = parseFloat(slider.value);
            const currentE = getStreakScaling();
            if (newE === currentE) { showToast('Streak scaling unchanged.', 'olive'); return; }
            if (!window.userData.settings) window.userData.settings = {};
            window.userData.settings.streakScaling = newE;
            await saveUserData();
            showToast('\ud83d\udd25 Streak scaling set to ' + newE.toFixed(1), 'olive');
        };

        // Settings functions
        function loadSettings() {
            const k = parseFloat(window.userData?.settings?.levelScaling || 8.5);
            const slider = document.getElementById('levelScalingSlider');
            if (slider) slider.value = k;
            previewLevelScaling(k);
            const se = parseFloat(window.userData?.settings?.streakScaling ?? 1.2);
            const sSlider = document.getElementById('streakScalingSlider');
            if (sSlider) { sSlider.value = se; previewStreakScaling(se); }
            loadTheme();
            renderStreakPauseList();
            updateRestoreBackupBtn();
        }

        // Live preview as user drags the slider — just updates the display, doesn't save
        window.previewLevelScaling = function(k) {
            k = parseFloat(k);
            const display = document.getElementById('scalingValueDisplay');
            if (display) display.textContent = k.toFixed(1);
            const table = document.getElementById('scalingPreviewTable');
            if (!table) return;
            const rows = [1, 5, 10, 20, 50, 99].map(l => {
                const xp = Math.round(k * (2 * l - 1));
                return `L${l}→${l+1}: <strong style="color:var(--color-text-primary);">${xp} XP</strong>`;
            });
            table.innerHTML = rows.join(' &nbsp;·&nbsp; ');
        };

        window.applyLevelScaling = async function() {
            const slider = document.getElementById('levelScalingSlider');
            if (!slider) return;
            const newK = parseFloat(slider.value);
            const currentK = getLevelScaling();
            if (newK === currentK) { showToast('Scaling unchanged.', 'olive'); return; }

            const direction = newK > currentK ? 'harder (higher level thresholds)' : 'easier (lower level thresholds)';
            const totalXP = window.userData.totalXP || 0;
            // Preview what level user would be at with new scaling
            let previewLevel = 1, rem = totalXP;
            while (rem >= Math.round(newK * (2 * previewLevel - 1)) && previewLevel < 100) {
                rem -= Math.round(newK * (2 * previewLevel - 1));
                previewLevel++;
            }

            const confirmed = confirm(
                `Change scaling from ${currentK} → ${newK} (${direction})?\n\n` +
                `Your total XP (${totalXP}) stays the same.\n` +
                `With the new formula your level will be recalculated to Level ${previewLevel}.\n\n` +
                `This affects all future level-up thresholds. Continue?`
            );
            if (!confirmed) {
                // Snap slider back to saved value
                slider.value = currentK;
                previewLevelScaling(currentK);
                return;
            }

            if (!window.userData.settings) window.userData.settings = {};
            window.userData.settings.levelScaling = newK;

            // Re-derive level + currentXP from totalXP using new formula
            let level = 1, currentXP = totalXP;
            while (currentXP >= Math.round(newK * (2 * level - 1)) && level < 100) {
                currentXP -= Math.round(newK * (2 * level - 1));
                level++;
            }
            window.userData.level   = level;
            window.userData.currentXP = Math.max(0, currentXP);

            // Re-derive dimension levels from each dimension's dimTotalXP
            (window.userData.dimensions || []).forEach(dim => {
                initDim(dim);
                let dLevel = 1, dXP = dim.dimTotalXP || 0;
                while (dXP >= Math.max(1, Math.round((newK / 2) * (2 * dLevel - 1))) && dLevel < 200) {
                    dXP -= Math.max(1, Math.round((newK / 2) * (2 * dLevel - 1)));
                    dLevel++;
                }
                dim.dimLevel = dLevel;
                dim.dimXP    = Math.max(0, dXP);
            });

            await saveUserData();
            updateDashboard();
            showToast(`✅ Scaling set to ${newK} — now Level ${level}`, 'olive');
        };

        // Keep old saveSettings stub for any legacy calls
        window.saveSettings = async function() {
            showToast('Use the scaling slider above.', 'blue');
        };

        // ── Quick-Add Activity ────────────────────────────────────────────

        window.openQuickAddActivity = function() {
            const dims = window.userData.dimensions || [];
            const noDims = dims.length === 0;

            // Show dim/path selectors
            document.getElementById('activityDimPathGroup').style.display = 'block';
            document.getElementById('activityNoDimsNotice').style.display = noDims ? 'block' : 'none';

            // Populate dimension dropdown
            const dimSel = document.getElementById('activityDimSelect');
            dimSel.innerHTML = '<option value="">— select dimension —</option>' +
                dims.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
            document.getElementById('activityPathSelect').innerHTML = '<option value="">— select path —</option>';

            // Set editingActivity state to null (new), but dim/path will be resolved at save time
            editingActivityDimIndex = -1; // -1 = quick-add mode
            editingActivityPathIndex = null;
            editingActivityIndex = null;

            const limitNotice = document.getElementById('activityLimitNotice');
            if (!canAddActivity()) {
                const { total, limit } = getActivityCounts();
                const level = window.userData.level || 1;
                let nextUnlockLevel = level + 1;
                while (getActivityLimit(nextUnlockLevel) <= limit) nextUnlockLevel++;
                document.getElementById('limitCurrent').textContent = total;
                document.getElementById('limitMax').textContent = limit;
                document.getElementById('limitNextLevel').textContent = nextUnlockLevel;
                limitNotice.style.display = 'block';
                document.querySelector('#activityForm button[type="submit"]').disabled = true;
            } else {
                limitNotice.style.display = 'none';
                document.querySelector('#activityForm button[type="submit"]').disabled = false;
            }
            document.getElementById('activityForm').reset();
            document.getElementById('activityFrequency').value = 'daily'; // always reset to daily
            document.getElementById('activityDimPathGroup').style.display = 'block';
            document.getElementById('activityNegativeEnabled').checked = false;
            document.getElementById('negativeXpSection').style.display = 'none';
            const _performRadio = document.querySelector('input[name="negativeXpMode"][value="perform"]');
            if (_performRadio) _performRadio.checked = true;
            if (window.toggleCustomDays) window.toggleCustomDays(); // reset custom interval visibility
            document.getElementById('activityModal').classList.add('active');
        };

        window.populateActivityPathSelect = function() {
            const dimId = document.getElementById('activityDimSelect').value;
            const dim = (window.userData.dimensions || []).find(d => d.id === dimId);
            const paths = dim ? (dim.paths || []) : [];
            document.getElementById('activityPathSelect').innerHTML =
                '<option value="">— select path —</option>' +
                paths.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
        };

        // ── Patch saveActivity to handle quick-add mode ───────────────────

        const _origSaveActivity = window.saveActivity;
        window.saveActivity = async function(event) {
            event.preventDefault();
            // Quick-add mode: resolve dim/path from dropdowns
            if (editingActivityDimIndex === -1) {
                const dimId  = document.getElementById('activityDimSelect').value;
                const pathId = document.getElementById('activityPathSelect').value;
                if (!dimId || !pathId) { alert('Please select a dimension and path.'); return; }
                const dims = window.userData.dimensions || [];
                const di = dims.findIndex(d => d.id === dimId);
                if (di === -1) { alert('Dimension not found.'); return; }
                const pi = dims[di].paths.findIndex(p => p.id === pathId);
                if (pi === -1) { alert('Path not found.'); return; }
                editingActivityDimIndex  = di;
                editingActivityPathIndex = pi;
                editingActivityIndex     = null;
            }
            // Now fall through to original logic
            const name      = document.getElementById('activityName').value;
            const baseXP    = parseInt(document.getElementById('activityXP').value);
            const frequency = document.getElementById('activityFrequency').value;
            const isNegativeEnabled = document.getElementById('activityNegativeEnabled').checked;
            const negativeXpMode = isNegativeEnabled
                ? (document.querySelector('input[name="negativeXpMode"]:checked')?.value || 'perform')
                : null;
            const isNegative = isNegativeEnabled && negativeXpMode === 'perform';
            const isSkipNegative = isNegativeEnabled && negativeXpMode === 'skip';
            const allowMultiplePerDay = (frequency !== 'occasional')
                ? (document.getElementById('activityAllowMultiple')?.checked || false)
                : false;

            const subtype = frequency === 'custom' ? getCustomSubtype() : null;
            const customDays = (frequency === 'custom' && subtype === 'cycle') ? Math.max(1, parseInt(document.getElementById('activityCustomDays').value) || 3) : null;
            const scheduledDays = (frequency === 'custom' && subtype === 'days') ? getSelectedDays() : null;
            const timesPerCycle = frequency === 'custom' ? Math.max(1, parseInt(document.getElementById('activityCustomTimes').value) || 1) : null;
            const deleteOnComplete = frequency === 'occasional' ? document.getElementById('activityDeleteOnComplete').checked : false;

            if (editingActivityIndex !== null) {
                const activity = window.userData.dimensions[editingActivityDimIndex]
                    .paths[editingActivityPathIndex].activities[editingActivityIndex];
                activity.name = name; activity.baseXP = baseXP;
                activity.frequency = frequency; activity.isNegative = isNegative;
                activity.isSkipNegative = isSkipNegative;
                activity.negativeXpMode = negativeXpMode;
                activity.allowMultiplePerDay = allowMultiplePerDay;
                if (frequency === 'custom') {
                    activity.customSubtype = subtype;
                    activity.customDays = customDays;
                    activity.scheduledDays = scheduledDays;
                    activity.timesPerCycle = timesPerCycle;
                } else {
                    activity.customSubtype = null;
                    activity.customDays = null;
                    activity.scheduledDays = null;
                    activity.timesPerCycle = null;
                }
                activity.deleteOnComplete = deleteOnComplete;
            } else {
                if (!canAddActivity()) { alert('You\'ve reached your activity limit! Level up to unlock more.'); return; }
                const path = window.userData.dimensions[editingActivityDimIndex].paths[editingActivityPathIndex];
                if (!path.activities) path.activities = [];
                path.activities.push({
                    id: Date.now().toString(), name, baseXP, frequency, isNegative, isSkipNegative, negativeXpMode,
                    allowMultiplePerDay,
                    customSubtype: subtype, customDays, scheduledDays, timesPerCycle,
                    deleteOnComplete,
                    streak: 0, lastCompleted: null, cycleCompletions: 0, totalXP: 0,
                    completionCount: 0, createdAt: new Date().toISOString()
                });
            }
            // Hide dim/path group for next open from dimensions tab
            document.getElementById('activityDimPathGroup').style.display = 'none';
            await saveUserData();
            closeActivityModal();
            updateDashboard();
        };

        // Patch closeActivityModal to hide dim/path group
        const _origCloseActivity = window.closeActivityModal;
        window.closeActivityModal = function() {
            document.getElementById('activityModal').classList.remove('active');
            document.getElementById('activityDimPathGroup').style.display = 'none';
            editingActivityDimIndex = null;
            editingActivityPathIndex = null;
            editingActivityIndex = null;
        };

        // Patch openActivityModal (dimensions tab) to keep dim/path group hidden
        const _origOpenActivity = window.openActivityModal;
        window.openActivityModal = function(dimIndex, pathIndex, actIndex = null) {
            document.getElementById('activityDimPathGroup').style.display = 'none';
            const limitNotice = document.getElementById('activityLimitNotice');
            if (actIndex === null && !canAddActivity()) {
                const { total, limit } = getActivityCounts();
                const level = window.userData.level || 1;
                let nextUnlockLevel = level + 1;
                while (getActivityLimit(nextUnlockLevel) <= limit) nextUnlockLevel++;
                document.getElementById('limitCurrent').textContent = total;
                document.getElementById('limitMax').textContent = limit;
                document.getElementById('limitNextLevel').textContent = nextUnlockLevel;
                limitNotice.style.display = 'block';
                document.querySelector('#activityForm button[type="submit"]').disabled = true;
            } else {
                limitNotice.style.display = 'none';
                document.querySelector('#activityForm button[type="submit"]').disabled = false;
            }
            editingActivityDimIndex  = dimIndex;
            editingActivityPathIndex = pathIndex;
            editingActivityIndex     = actIndex;
            const title = document.getElementById('activityModalTitle');
            if (actIndex !== null) {
                title.textContent = 'Edit Activity';
                const activity = window.userData.dimensions[dimIndex].paths[pathIndex].activities[actIndex];
                document.getElementById('activityName').value      = activity.name;
                document.getElementById('activityXP').value        = activity.baseXP;
                document.getElementById('activityFrequency').value = activity.frequency;
                // Negative XP fields
                const isNegEnabled = !!(activity.isNegative || activity.isSkipNegative);
                document.getElementById('activityNegativeEnabled').checked = isNegEnabled;
                document.getElementById('negativeXpSection').style.display = isNegEnabled ? 'block' : 'none';
                const mode = activity.negativeXpMode || (activity.isNegative ? 'perform' : 'skip');
                const modeEl = document.querySelector(`input[name="negativeXpMode"][value="${mode}"]`);
                if (modeEl) modeEl.checked = true;
                // Allow multiple per day
                const multiEl = document.getElementById('activityAllowMultiple');
                if (multiEl) multiEl.checked = activity.allowMultiplePerDay || false;
                document.getElementById('activityDeleteOnComplete').checked = activity.deleteOnComplete || false;
                if (window.toggleCustomDays) window.toggleCustomDays();
                if (activity.frequency === 'custom') {
                    const sub = activity.customSubtype || 'cycle';
                    setCustomSubtypeUI(sub);
                    if (sub === 'cycle') {
                        document.getElementById('activityCustomDays').value = activity.customDays || 3;
                    } else {
                        setSelectedDays(activity.scheduledDays || []);
                    }
                    document.getElementById('activityCustomTimes').value = activity.timesPerCycle || 1;
                }
            } else {
                title.textContent = 'Create Activity';
                document.getElementById('activityForm').reset();
                document.getElementById('activityFrequency').value = 'daily';
                document.getElementById('activityNegativeEnabled').checked = false;
                document.getElementById('negativeXpSection').style.display = 'none';
                const performRadio = document.querySelector('input[name="negativeXpMode"][value="perform"]');
                if (performRadio) performRadio.checked = true;
                const grp = document.getElementById('customDaysGroup');
                if (grp) grp.style.display = 'none';
                const multiGrp = document.getElementById('allowMultipleGroup');
                if (multiGrp) multiGrp.style.display = 'none';
                if (window.toggleCustomDays) window.toggleCustomDays();
            }
            document.getElementById('activityModal').classList.add('active');
        };

        // ── Theme Customizer ──────────────────────────────────────────────

        const THEMES = [
            { id:'default',  name:'Dark',      bg:'#181818', card:'#242424', accent:'#4472a0', progress:'#537db8' },
            { id:'midnight', name:'Midnight',  bg:'#0e0e1a', card:'#181825', accent:'#6259b8', progress:'#7870cc' },
            { id:'forest',   name:'Forest',    bg:'#111a11', card:'#192019', accent:'#3d7a46', progress:'#4e8f58' },
            { id:'crimson',  name:'Crimson',   bg:'#190e0e', card:'#231515', accent:'#8c3535', progress:'#a04545' },
            { id:'sand',     name:'Sand',      bg:'#191711', card:'#231f17', accent:'#8c7a3d', progress:'#a08f52' },
            { id:'slate',    name:'Slate',     bg:'#111520', card:'#191e2c', accent:'#4d6b9e', progress:'#637fb5' },
        ];

        // All CSS variables exposed in the custom editor
        const CUSTOM_COLOR_VARS = [
            { id:'bg',        label:'Background',     variable:'--color-bg-primary',   default:'#1a1a1a' },
            { id:'secondary', label:'Surface',        variable:'--color-bg-secondary', default:'#2a2a2a' },
            { id:'card',      label:'Cards',          variable:'--color-bg-card',      default:'#2d2d2d' },
            { id:'border',    label:'Borders',        variable:'--color-border',       default:'#3a3a3a' },
            { id:'text',      label:'Text',           variable:'--color-text-primary', default:'#ffffff' },
            { id:'subtext',   label:'Subtext',        variable:'--color-text-secondary',default:'#b0b0b0' },
            { id:'accent',    label:'Primary Accent', variable:'--color-accent-blue',  default:'#4a7c9e' },
            { id:'progress',  label:'XP / Progress',  variable:'--color-progress',     default:'#5a9fd4' },
            { id:'danger',    label:'Danger / Neg',   variable:'--color-accent-red',   default:'#8e3b5f' },
            { id:'success',   label:'Success',        variable:'--color-accent-green', default:'#6b7c3f' },
            { id:'dim',       label:'Dimension',      variable:'--color-accent-olive', default:'#7a7b4d' },
        ];

        const GRADIENT_PRESETS = [
            { name:'Aurora',  a:'#00c4cc', ao:18, m:'#3a1a7a', mo:10, b:'#7b2ff7', bo:14, angle:135 },
            { name:'Ember',   a:'#e84545', ao:16, m:'#8c3a00', mo:8,  b:'#ff8c00', bo:12, angle:160 },
            { name:'Ocean',   a:'#0077b6', ao:20, m:'#023e5a', mo:10, b:'#00b4d8', bo:10, angle:145 },
            { name:'Sakura',  a:'#e0529b', ao:14, m:'#8a1a4a', mo:8,  b:'#f7a1c4', bo:12, angle:130 },
            { name:'Verdant', a:'#2d6a4f', ao:18, m:'#1a4a2a', mo:8,  b:'#95d5b2', bo:12, angle:150 },
            { name:'Dusk',    a:'#6a0572', ao:16, m:'#3a1a00', mo:8,  b:'#e29578', bo:10, angle:140 },
            { name:'Ice',     a:'#a8dadc', ao:14, m:'#1a3a5a', mo:8,  b:'#457b9d', bo:12, angle:125 },
            { name:'None',    a:'#000000', ao:0,  m:'#000000', mo:0,  b:'#000000', bo:0,  angle:135 },
        ];

        function hexToRgb(h) {
            h = (h || '#000000').replace('#','');
            if (h.length === 3) h = h.split('').map(function(c){return c+c;}).join('');
            var n = parseInt(h, 16);
            return [(n>>16)&255, (n>>8)&255, n&255];
        }

        // Copy a hex value from an input to clipboard
        window.copyHex = function(inputId) {
            var el = document.getElementById(inputId);
            if (!el) return;
            var val = el.value;
            if (navigator.clipboard) {
                navigator.clipboard.writeText(val).then(function() {
                    showToast('Copied ' + val, 'olive');
                }).catch(function() {});
            } else {
                // Fallback for older browsers
                el.select();
                try { document.execCommand('copy'); showToast('Copied ' + val, 'olive'); } catch(e) {}
            }
        };

        // Text hex input → colour picker + live CSS (colour section)
        window.onColorHexTextInput = function(id, cssVar) {
            var txt = document.getElementById('ctxt_' + id);
            if (!txt) return;
            var val = txt.value.trim();
            if (!/^#[0-9a-fA-F]{6}$/.test(val)) return; // wait for full valid hex
            var picker = document.getElementById('cp_' + id);
            if (picker) picker.value = val;
            var hex = document.getElementById('chex_' + id);
            if (hex) hex.textContent = val;
            document.documentElement.style.setProperty(cssVar, val);
            if (!window._pendingTheme) window._pendingTheme = {};
            window._pendingTheme['custom_' + id] = val;
        };

        // Glow colour picker → hex text input
        window.onGlowColorInput = function(stop) {
            var picker = document.getElementById('glow' + stop + 'Color');
            var hex    = document.getElementById('glow' + stop + 'Hex');
            if (picker && hex) hex.value = picker.value;
            updateGradientPreview();
        };

        // Glow hex text input → colour picker
        window.onGlowHexInput = function(stop) {
            var hex    = document.getElementById('glow' + stop + 'Hex');
            var picker = document.getElementById('glow' + stop + 'Color');
            if (!hex || !picker) return;
            var val = hex.value.trim();
            if (!/^#[0-9a-fA-F]{6}$/.test(val)) return;
            picker.value = val;
            updateGradientPreview();
        };

        function buildColorGrid() {
            var grid = document.getElementById('themeColorGrid');
            if (!grid) return;
            var saved = (window.userData.settings && window.userData.settings.theme) || {};
            var html = '';
            CUSTOM_COLOR_VARS.forEach(function(v) {
                var live = getComputedStyle(document.documentElement).getPropertyValue(v.variable).trim();
                var val = saved['custom_' + v.id] || live || v.default;
                val = normalizeToHex(val) || v.default;
                html += '<div class="theme-color-row">'
                    + '<span class="theme-color-label">' + v.label + '</span>'
                    + '<div class="theme-color-input-wrap" onclick="document.getElementById(\'cp_' + v.id + '\').click()">'
                    + '<input type="color" id="cp_' + v.id + '" value="' + val + '" data-var="' + v.variable + '" data-id="' + v.id + '" oninput="onCustomColorInput(this)">'
                    + '<span class="theme-color-hex" id="chex_' + v.id + '">' + val + '</span>'
                    + '</div>'
                    + '<div class="theme-color-hex-row">'
                    + '<input type="text" class="theme-color-hex-input" id="ctxt_' + v.id + '" value="' + val + '" maxlength="7" placeholder="#rrggbb"'
                    + ' oninput="onColorHexTextInput(\'' + v.id + '\',\'' + v.variable + '\')">'
                    + '<button class="theme-color-hex-copy" onclick="copyHex(\'ctxt_' + v.id + '\')" title="Copy">⧉</button>'
                    + '</div>'
                    + '</div>';
            });
            grid.innerHTML = html;
        }

        // Convert any CSS color string to hex (handles #hex, rgb(), rgba())
        function normalizeToHex(color) {
            if (!color) return null;
            color = color.trim();
            if (/^#[0-9a-fA-F]{3,6}$/.test(color)) return color.length === 4
                ? '#' + color[1]+color[1]+color[2]+color[2]+color[3]+color[3]
                : color;
            var m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (m) return '#' + [m[1],m[2],m[3]].map(function(n){return parseInt(n).toString(16).padStart(2,'0');}).join('');
            return null;
        }

        function buildGradientPresets() {
            var el = document.getElementById('gradientPresets');
            if (!el) return;
            var html = '';
            GRADIENT_PRESETS.forEach(function(p) {
                var aRgb = hexToRgb(p.a);
                var bRgb = hexToRgb(p.b);
                var dot = 'background:linear-gradient(135deg,'
                    + 'rgba(' + aRgb[0] + ',' + aRgb[1] + ',' + aRgb[2] + ',' + (p.ao/100) + ') 0%,'
                    + 'rgba(' + bRgb[0] + ',' + bRgb[1] + ',' + bRgb[2] + ',' + (p.bo/100) + ') 100%);';
                html += '<button class="theme-preset-pill" onclick="applyGradientPreset(\'' + p.name + '\')">'
                    + '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;' + dot + '"></span>'
                    + p.name + '</button>';
            });
            el.innerHTML = html;
        }

        window.applyGradientPreset = function(name) {
            var p = GRADIENT_PRESETS.find(function(x){ return x.name === name; });
            if (!p) return;
            // Glow A
            var elAC = document.getElementById('glowAColor');
            var elAO = document.getElementById('glowAOpacity');
            var elAH = document.getElementById('glowAHex');
            if (elAC) elAC.value = p.a;
            if (elAH) elAH.value = p.a;
            if (elAO) { elAO.value = p.ao; document.getElementById('glowAVal').textContent = p.ao + '%'; }
            // Glow M
            var elMC = document.getElementById('glowMColor');
            var elMO = document.getElementById('glowMOpacity');
            var elMH = document.getElementById('glowMHex');
            if (elMC) elMC.value = p.m;
            if (elMH) elMH.value = p.m;
            if (elMO) { elMO.value = p.mo; document.getElementById('glowMVal').textContent = p.mo + '%'; }
            // Glow B
            var elBC = document.getElementById('glowBColor');
            var elBO = document.getElementById('glowBOpacity');
            var elBH = document.getElementById('glowBHex');
            if (elBC) elBC.value = p.b;
            if (elBH) elBH.value = p.b;
            if (elBO) { elBO.value = p.bo; document.getElementById('glowBVal').textContent = p.bo + '%'; }
            // Angle
            var elAngle = document.getElementById('glowAngle');
            if (elAngle) { elAngle.value = p.angle || 135; document.getElementById('glowAngleVal').textContent = (p.angle || 135) + '°'; }
            updateGradientPreview();
        };

        // ── Helper: read a glow stop value safely ───────────────────────────
        function _glowVal(id, fallback) {
            var el = document.getElementById(id);
            return el ? el.value : fallback;
        }
        function _glowInt(id, fallback) {
            var el = document.getElementById(id);
            return el ? parseInt(el.value) : fallback;
        }

        window.updateGradientPreview = function() {
            var aC = _glowVal('glowAColor', '#4a7c9e');
            var aO = _glowInt('glowAOpacity', 14) / 100;
            var mC = _glowVal('glowMColor', '#3a3a5c');
            var mO = _glowInt('glowMOpacity', 8) / 100;
            var bC = _glowVal('glowBColor', '#8e3b5f');
            var bO = _glowInt('glowBOpacity', 10) / 100;
            var angle = _glowInt('glowAngle', 135);

            var aRgb = hexToRgb(aC), mRgb = hexToRgb(mC), bRgb = hexToRgb(bC);
            var glowA = 'rgba(' + aRgb[0] + ',' + aRgb[1] + ',' + aRgb[2] + ',' + aO + ')';
            var glowM = 'rgba(' + mRgb[0] + ',' + mRgb[1] + ',' + mRgb[2] + ',' + mO + ')';
            var glowB = 'rgba(' + bRgb[0] + ',' + bRgb[1] + ',' + bRgb[2] + ',' + bO + ')';

            // Translate angle to radial gradient positions (0°=top, 90°=right, 180°=bottom, 270°=left)
            var rad = (angle - 90) * Math.PI / 180;
            // Position A: opposite of angle direction (start)
            var axPct = Math.round(50 - Math.cos(rad) * 45);
            var ayPct = Math.round(50 - Math.sin(rad) * 45);
            // Position B: in the angle direction (end)
            var bxPct = Math.round(50 + Math.cos(rad) * 45);
            var byPct = Math.round(50 + Math.sin(rad) * 45);

            document.documentElement.style.setProperty('--color-bg-glow-a', glowA);
            document.documentElement.style.setProperty('--color-bg-glow-m', glowM);
            document.documentElement.style.setProperty('--color-bg-glow-b', glowB);

            // Translate angle → two radial-gradient focal positions (A=start, B=end)
            var rad2 = (angle - 90) * Math.PI / 180;
            var axPct = Math.round(50 - Math.cos(rad2) * 42);
            var ayPct = Math.round(50 - Math.sin(rad2) * 42);
            var bxPct = Math.round(50 + Math.cos(rad2) * 42);
            var byPct = Math.round(50 + Math.sin(rad2) * 42);
            document.documentElement.style.setProperty('--glow-a-x', axPct + '%');
            document.documentElement.style.setProperty('--glow-a-y', ayPct + '%');
            document.documentElement.style.setProperty('--glow-b-x', bxPct + '%');
            document.documentElement.style.setProperty('--glow-b-y', byPct + '%');

            if (!window._pendingTheme) window._pendingTheme = {};
            window._pendingTheme.glowA = { color: aC, opacity: aO };
            window._pendingTheme.glowM = { color: mC, opacity: mO };
            window._pendingTheme.glowB = { color: bC, opacity: bO };
            window._pendingTheme.glowAngle = angle;
        };

        window.onCustomColorInput = function(input) {
            var val = input.value;
            var variable = input.getAttribute('data-var');
            var id = input.getAttribute('data-id');
            document.documentElement.style.setProperty(variable, val);
            // Sync both hex display and text input
            var hexSpan = document.getElementById('chex_' + id);
            if (hexSpan) hexSpan.textContent = val;
            var hexTxt = document.getElementById('ctxt_' + id);
            if (hexTxt) hexTxt.value = val;
            if (!window._pendingTheme) window._pendingTheme = {};
            window._pendingTheme['custom_' + id] = val;
            // Keep legacy accent/progress in sync for rest of app
            if (id === 'accent')   { document.getElementById('themeAccentPicker').value   = val; applyBgGlow(val, document.getElementById('cp_progress') ? document.getElementById('cp_progress').value : val); }
            if (id === 'progress') { document.getElementById('themeProgressPicker').value = val; }
            if (id === 'bg') {
                updateGradientPreview();
            }
        };

        // ── Helper: apply all glow CSS vars from saved theme object ─────────
        function _applyGlowsFromSaved(saved) {
            if (saved.glowA) {
                var a = saved.glowA; var aRgb = hexToRgb(a.color);
                document.documentElement.style.setProperty('--color-bg-glow-a', 'rgba(' + aRgb[0] + ',' + aRgb[1] + ',' + aRgb[2] + ',' + a.opacity + ')');
            }
            if (saved.glowM) {
                var m = saved.glowM; var mRgb = hexToRgb(m.color);
                document.documentElement.style.setProperty('--color-bg-glow-m', 'rgba(' + mRgb[0] + ',' + mRgb[1] + ',' + mRgb[2] + ',' + m.opacity + ')');
            }
            if (saved.glowB) {
                var b = saved.glowB; var bRgb = hexToRgb(b.color);
                document.documentElement.style.setProperty('--color-bg-glow-b', 'rgba(' + bRgb[0] + ',' + bRgb[1] + ',' + bRgb[2] + ',' + b.opacity + ')');
            }
            // Restore gradient focal positions from saved angle
            if (saved.glowAngle != null) {
                var angle = saved.glowAngle;
                var rad2 = (angle - 90) * Math.PI / 180;
                var axPct = Math.round(50 - Math.cos(rad2) * 42);
                var ayPct = Math.round(50 - Math.sin(rad2) * 42);
                var bxPct = Math.round(50 + Math.cos(rad2) * 42);
                var byPct = Math.round(50 + Math.sin(rad2) * 42);
                document.documentElement.style.setProperty('--glow-a-x', axPct + '%');
                document.documentElement.style.setProperty('--glow-a-y', ayPct + '%');
                document.documentElement.style.setProperty('--glow-b-x', bxPct + '%');
                document.documentElement.style.setProperty('--glow-b-y', byPct + '%');
            }
        }

        // ── Helper: restore gradient slider UIs from saved theme ─────────────
        function _restoreGlowSliders(saved) {
            function setSingle(stop, key) {
                var g = saved[key];
                if (!g) return;
                var elC = document.getElementById('glow' + stop + 'Color');
                var elH = document.getElementById('glow' + stop + 'Hex');
                var elO = document.getElementById('glow' + stop + 'Opacity');
                var elV = document.getElementById('glow' + stop + 'Val');
                if (elC) elC.value = g.color;
                if (elH) elH.value = g.color;
                if (elO) { var pct = Math.round(g.opacity * 100); elO.value = pct; if (elV) elV.textContent = pct + '%'; }
            }
            setSingle('A', 'glowA');
            setSingle('M', 'glowM');
            setSingle('B', 'glowB');
            var angle = saved.glowAngle != null ? saved.glowAngle : 135;
            var elAngle = document.getElementById('glowAngle');
            if (elAngle) { elAngle.value = angle; document.getElementById('glowAngleVal').textContent = angle + '°'; }
        }

        function loadTheme() {
            var saved = (window.userData.settings && window.userData.settings.theme) ? window.userData.settings.theme : {};
            var presets = document.getElementById('themePresets');
            if (!presets) return;
            var activeId = saved.presetId || 'default';

            // Build preset swatches
            var swatchHtml = '';
            THEMES.forEach(function(t) {
                swatchHtml += '<div class="theme-swatch ' + (t.id === activeId ? 'active' : '') + '" onclick="applyThemePreset(\'' + t.id + '\', this)">'
                    + '<div class="theme-swatch-colors">'
                    + '<div class="theme-swatch-dot" style="background:' + t.bg + ';border:1px solid #444;"></div>'
                    + '<div class="theme-swatch-dot" style="background:' + t.accent + ';"></div>'
                    + '<div class="theme-swatch-dot" style="background:' + t.progress + ';"></div>'
                    + '</div>'
                    + '<span class="theme-swatch-name">' + t.name + '</span>'
                    + '</div>';
            });
            var customActive = activeId === 'custom';
            swatchHtml += '<div class="theme-swatch ' + (customActive ? 'active' : '') + '" id="customSwatch" onclick="activateCustomTheme(this)">'
                + '<div class="theme-swatch-colors">'
                + '<div class="theme-swatch-dot" style="background:conic-gradient(#e84545,#f7b731,#2ecc71,#4a7c9e,#9b59b6,#e84545);border:none;"></div>'
                + '</div>'
                + '<span class="theme-swatch-name">Custom</span>'
                + '</div>';
            presets.innerHTML = swatchHtml;

            // Restore pickers
            if (saved.accent)   document.getElementById('themeAccentPicker').value   = saved.accent;
            if (saved.progress) document.getElementById('themeProgressPicker').value = saved.progress;

            // Apply all stored custom colour vars first (before glow, to avoid overwrite)
            CUSTOM_COLOR_VARS.forEach(function(v) {
                var val = saved['custom_' + v.id];
                if (val) document.documentElement.style.setProperty(v.variable, val);
            });
            // Also apply legacy top-level colour fields
            if (saved.bg)        document.documentElement.style.setProperty('--color-bg-primary',    saved.bg);
            if (saved.card)      document.documentElement.style.setProperty('--color-bg-card',        saved.card);
            if (saved.secondary) document.documentElement.style.setProperty('--color-bg-secondary',   saved.secondary);
            if (saved.accent)    document.documentElement.style.setProperty('--color-accent-blue',    saved.accent);
            if (saved.progress)  document.documentElement.style.setProperty('--color-progress',       saved.progress);

            // Apply glows — use custom glow data if present, else fall back to accent-derived glow
            var hasCustomGlows = !!(saved.glowA || saved.glowM || saved.glowB);
            if (hasCustomGlows) {
                _applyGlowsFromSaved(saved);
            } else {
                applyBgGlow(saved.accent || '#4472a0', saved.progress || '#537db8');
            }

            // Show custom controls if it was active — but keep panel collapsed (user expands when needed)
            if (customActive) {
                var colHdr = document.getElementById('themeCustomCollapseHeader');
                if (colHdr) colHdr.style.display = 'flex';
                var resetRow = document.getElementById('themeResetRow');
                if (resetRow) resetRow.style.display = 'block';
                var slotBtn = document.getElementById('saveCustomSlotBtn');
                if (slotBtn) slotBtn.style.display = 'inline-flex';
                buildColorGrid();
                buildGradientPresets();
                _restoreGlowSliders(saved);
                renderSavedThemeSlots();
            }
        }

        window.activateCustomTheme = function(el) {
            document.querySelectorAll('.theme-swatch').forEach(function(s){ s.classList.remove('active'); });
            el.classList.add('active');
            var colHdr = document.getElementById('themeCustomCollapseHeader');
            if (colHdr) colHdr.style.display = 'flex';
            var resetRow = document.getElementById('themeResetRow');
            if (resetRow) resetRow.style.display = 'block';
            var slotBtn = document.getElementById('saveCustomSlotBtn');
            if (slotBtn) slotBtn.style.display = 'inline-flex';
            buildColorGrid();
            buildGradientPresets();
            var saved = (window.userData.settings && window.userData.settings.theme) || {};
            _restoreGlowSliders(saved);
            renderSavedThemeSlots();
            if (!window._pendingTheme) window._pendingTheme = {};
            window._pendingTheme.presetId = 'custom';
            // Panel stays collapsed until user taps the header
        };

        window.toggleCustomThemePanel = function() {
            var panel = document.getElementById('themeCustomPanel');
            var chevron = document.getElementById('customPanelChevron');
            if (!panel) return;
            var isOpen = panel.classList.contains('visible');
            if (isOpen) {
                panel.classList.remove('visible');
                if (chevron) chevron.style.transform = '';
            } else {
                panel.classList.add('visible');
                if (chevron) chevron.style.transform = 'rotate(180deg)';
            }
        };

        window.applyThemePreset = function(id, el) {
            var t = THEMES.find(function(x){return x.id===id;});
            if (!t) return;
            // Reset ALL custom colour vars to defaults first so no leftover custom-theme
            // values bleed through when switching to a preset.
            CUSTOM_COLOR_VARS.forEach(function(v) {
                document.documentElement.style.setProperty(v.variable, v.default);
            });
            document.documentElement.style.setProperty('--color-bg-primary',   t.bg);
            document.documentElement.style.setProperty('--color-bg-secondary', adjustColor(t.bg, 20));
            document.documentElement.style.setProperty('--color-bg-card',      t.card);
            document.documentElement.style.setProperty('--color-accent-blue',  t.accent);
            document.documentElement.style.setProperty('--color-progress',     t.progress);
            applyBgGlow(t.accent, t.progress);
            document.getElementById('themeAccentPicker').value   = t.accent;
            document.getElementById('themeProgressPicker').value = t.progress;
            // Hide custom panel, collapse header, reset row, slot button
            var panel = document.getElementById('themeCustomPanel');
            if (panel) panel.classList.remove('visible');
            var colHdr = document.getElementById('themeCustomCollapseHeader');
            if (colHdr) colHdr.style.display = 'none';
            var resetRow = document.getElementById('themeResetRow');
            if (resetRow) resetRow.style.display = 'none';
            var slotBtn = document.getElementById('saveCustomSlotBtn');
            if (slotBtn) slotBtn.style.display = 'none';
            document.querySelectorAll('.theme-swatch').forEach(function(s){ s.classList.remove('active'); });
            if (el) el.classList.add('active');
            window._pendingTheme = { presetId: id, bg: t.bg, card: t.card,
                secondary: adjustColor(t.bg, 20), accent: t.accent, progress: t.progress };
        };

        window.previewThemeColor = function(which, value) {
            if (which === 'accent')   document.documentElement.style.setProperty('--color-accent-blue', value);
            if (which === 'progress') document.documentElement.style.setProperty('--color-progress', value);
            var accent   = which === 'accent'   ? value : document.getElementById('themeAccentPicker').value;
            var progress = which === 'progress' ? value : document.getElementById('themeProgressPicker').value;
            applyBgGlow(accent, progress);
            window._pendingTheme = window._pendingTheme || {};
            window._pendingTheme[which === 'accent' ? 'accent' : 'progress'] = value;
        };

        window.saveTheme = async function() {
            if (!window.userData.settings) window.userData.settings = {};
            var pending = window._pendingTheme || {};
            if (pending.presetId === 'custom') {
                // Snapshot all custom colour pickers
                CUSTOM_COLOR_VARS.forEach(function(v) {
                    var el = document.getElementById('cp_' + v.id);
                    if (el) pending['custom_' + v.id] = el.value;
                });
                // Sync legacy top-level fields from pickers
                if (document.getElementById('cp_accent'))    pending.accent    = document.getElementById('cp_accent').value;
                if (document.getElementById('cp_progress'))  pending.progress  = document.getElementById('cp_progress').value;
                if (document.getElementById('cp_bg'))        pending.bg        = document.getElementById('cp_bg').value;
                if (document.getElementById('cp_card'))      pending.card      = document.getElementById('cp_card').value;
                if (document.getElementById('cp_secondary')) pending.secondary = document.getElementById('cp_secondary').value;
                // Snapshot glow controls
                var aC = _glowVal('glowAColor','#4a7c9e'), aO = _glowInt('glowAOpacity',14)/100;
                var mC = _glowVal('glowMColor','#3a3a5c'), mO = _glowInt('glowMOpacity',8)/100;
                var bC = _glowVal('glowBColor','#8e3b5f'), bO = _glowInt('glowBOpacity',10)/100;
                pending.glowA = { color: aC, opacity: aO };
                pending.glowM = { color: mC, opacity: mO };
                pending.glowB = { color: bC, opacity: bO };
                pending.glowAngle = _glowInt('glowAngle', 135);
            } else {
                pending.accent   = document.getElementById('themeAccentPicker').value;
                pending.progress = document.getElementById('themeProgressPicker').value;
            }
            window.userData.settings.theme = pending;
            await saveUserData();
            showToast('🎨 Theme saved!', 'blue');
        };

        window.resetCustomTheme = function() {
            var saved = (window.userData.settings && window.userData.settings.theme) || {};
            // Restore every CSS variable from saved state (or hardcoded defaults)
            CUSTOM_COLOR_VARS.forEach(function(v) {
                var val = saved['custom_' + v.id] || v.default;
                document.documentElement.style.setProperty(v.variable, val);
            });
            if (saved.accent)    document.documentElement.style.setProperty('--color-accent-blue',   saved.accent);
            if (saved.progress)  document.documentElement.style.setProperty('--color-progress',      saved.progress);
            if (saved.bg)        document.documentElement.style.setProperty('--color-bg-primary',    saved.bg);
            if (saved.card)      document.documentElement.style.setProperty('--color-bg-card',       saved.card);
            if (saved.secondary) document.documentElement.style.setProperty('--color-bg-secondary',  saved.secondary);
            // Restore glows — don't call applyBgGlow here, that would overwrite custom glow data
            var hasCustomGlows = !!(saved.glowA || saved.glowM || saved.glowB);
            if (hasCustomGlows) {
                _applyGlowsFromSaved(saved);
            } else {
                applyBgGlow(saved.accent || '#4472a0', saved.progress || '#537db8');
            }
            window._pendingTheme = JSON.parse(JSON.stringify(saved));
            buildColorGrid();
            buildGradientPresets();
            _restoreGlowSliders(saved);
            showToast('↺ Reverted to saved theme', 'blue');
        };

        // Apply radial glow to body (preset mode only — does NOT overwrite custom glows)
        function applyBgGlow(accentHex, progressHex) {
            try {
                var ar = hexToRgb(accentHex   || '#4472a0');
                var pr = hexToRgb(progressHex || '#537db8');
                document.documentElement.style.setProperty('--color-bg-glow-a', 'rgba(' + ar[0] + ',' + ar[1] + ',' + ar[2] + ',0.14)');
                document.documentElement.style.setProperty('--color-bg-glow-m', 'rgba(' + ar[0] + ',' + ar[1] + ',' + ar[2] + ',0.06)');
                document.documentElement.style.setProperty('--color-bg-glow-b', 'rgba(' + pr[0] + ',' + pr[1] + ',' + pr[2] + ',0.10)');
            } catch(e) {}
        }

        // ── Saved Custom Theme Slots (3 slots stored in userData.settings.savedThemes) ──

        window.saveCustomSlot = function() {
            if (!window.userData.settings) window.userData.settings = {};
            var slots = window.userData.settings.savedThemes || [];
            if (slots.length >= 3) {
                showToast('Max 3 templates — delete one first', 'red');
                return;
            }
            var pending = JSON.parse(JSON.stringify(window._pendingTheme || {}));
            // Snapshot all pickers into pending before saving
            CUSTOM_COLOR_VARS.forEach(function(v) {
                var el = document.getElementById('cp_' + v.id);
                if (el) pending['custom_' + v.id] = el.value;
            });
            pending.glowA = { color: _glowVal('glowAColor','#4a7c9e'), opacity: _glowInt('glowAOpacity',14)/100 };
            pending.glowM = { color: _glowVal('glowMColor','#3a3a5c'), opacity: _glowInt('glowMOpacity',8)/100 };
            pending.glowB = { color: _glowVal('glowBColor','#8e3b5f'), opacity: _glowInt('glowBOpacity',10)/100 };
            pending.glowAngle = _glowInt('glowAngle', 135);
            // Give it a name from the bg colour
            pending._savedName = 'Theme ' + (slots.length + 1);
            pending.presetId = 'custom';
            slots.push(pending);
            window.userData.settings.savedThemes = slots;
            saveUserData();
            renderSavedThemeSlots();
            showToast('💾 Template saved!', 'olive');
        };

        window.deleteSavedThemeSlot = function(idx) {
            var slots = (window.userData.settings && window.userData.settings.savedThemes) || [];
            slots.splice(idx, 1);
            window.userData.settings.savedThemes = slots;
            saveUserData();
            renderSavedThemeSlots();
            showToast('Template deleted', 'red');
        };

        window.loadSavedThemeSlot = function(idx) {
            var slots = (window.userData.settings && window.userData.settings.savedThemes) || [];
            var slot = slots[idx];
            if (!slot) return;
            // Apply all colour vars
            CUSTOM_COLOR_VARS.forEach(function(v) {
                var val = slot['custom_' + v.id];
                if (val) document.documentElement.style.setProperty(v.variable, val);
            });
            if (slot.bg)        document.documentElement.style.setProperty('--color-bg-primary',   slot.bg);
            if (slot.card)      document.documentElement.style.setProperty('--color-bg-card',      slot.card);
            if (slot.secondary) document.documentElement.style.setProperty('--color-bg-secondary', slot.secondary);
            if (slot.accent)    document.documentElement.style.setProperty('--color-accent-blue',  slot.accent);
            if (slot.progress)  document.documentElement.style.setProperty('--color-progress',     slot.progress);
            _applyGlowsFromSaved(slot);
            window._pendingTheme = JSON.parse(JSON.stringify(slot));
            window._pendingTheme.presetId = 'custom';
            buildColorGrid();
            buildGradientPresets();
            _restoreGlowSliders(slot);
            showToast('Template loaded — hit Apply to save', 'blue');
        };

        function renderSavedThemeSlots() {
            var el = document.getElementById('themeSavedSlots');
            if (!el) return;
            var slots = (window.userData.settings && window.userData.settings.savedThemes) || [];
            var html = '';
            for (var i = 0; i < 3; i++) {
                var slot = slots[i];
                if (slot) {
                    var swatchColor = (slot.custom_accent || slot.accent || '#4a7c9e');
                    html += '<div class="theme-saved-slot" onclick="loadSavedThemeSlot(' + i + ')">'
                        + '<div class="slot-swatch" style="background:' + swatchColor + ';"></div>'
                        + '<span>' + (slot._savedName || ('Theme ' + (i+1))) + '</span>'
                        + '<button class="theme-saved-slot-del" onclick="event.stopPropagation();deleteSavedThemeSlot(' + i + ')" title="Delete">✕</button>'
                        + '</div>';
                } else {
                    html += '<div class="theme-saved-slot empty">Slot ' + (i+1) + ' empty</div>';
                }
            }
            el.innerHTML = html;
        }

        // Hex color brightness adjustment helper
        function adjustColor(hex, amount) {
            const num = parseInt(hex.replace('#',''), 16);
            const r = Math.min(255, ((num >> 16) & 0xff) + amount);
            const g = Math.min(255, ((num >> 8)  & 0xff) + amount);
            const b = Math.min(255, ( num        & 0xff) + amount);
            return '#' + [r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
        }

        // ── Streak Pause (Shield) ─────────────────────────────────────────

        function streakLabel(act) {
            const n = act.streak || 0;
            if (act.frequency === 'daily') return `🔥 ${n} day streak`;
            return `🔥 ${n} streak`;
        }

                function renderStreakPauseList() {
            const el = document.getElementById('streakPauseList');
            const sel = document.getElementById('streakPauseActivitySelect');
            if (!el || !sel) return;
            const all = [];
            (window.userData.dimensions || []).forEach(dim => {
                (dim.paths || []).forEach(path => {
                    (path.activities || []).forEach(act => {
                        // Include all streak-eligible activities: non-occasional and non-negative
                        if (act.frequency !== 'occasional' && !act.isNegative) {
                            all.push({ ...act, dimName: dim.name, pathName: path.name });
                        }
                    });
                });
            });
            // Populate select
            const currentVal = sel.value;
            sel.innerHTML = '<option value="">— Choose an activity —</option>' +
                all.map(act => `<option value="${act.id}" ${act.id === currentVal ? 'selected' : ''}>${escapeHtml(act.name)} (${act.dimName})</option>`).join('');
            // Render selected
            renderStreakPauseForSelected(all);
        }

        window.renderStreakPauseForSelected = function(allOverride) {
            const el = document.getElementById('streakPauseList');
            const sel = document.getElementById('streakPauseActivitySelect');
            if (!el || !sel) return;
            const selectedId = sel.value;
            if (!selectedId) { el.innerHTML = ''; return; }
            const all = allOverride || [];
            if (!allOverride) {
                (window.userData.dimensions || []).forEach(dim =>
                    (dim.paths || []).forEach(path =>
                        (path.activities || []).forEach(act => {
                            if (act.frequency !== 'occasional' && !act.isNegative)
                                all.push({ ...act, dimName: dim.name, pathName: path.name });
                        })));
            }
            const act = all.find(a => a.id === selectedId);
            if (!act) { el.innerHTML = ''; return; }
            const uses  = act.streakPauseUses || 0;
            const maxU  = 3;
            const isPaused = act.streakPaused;
            const dotsHtml = Array.from({length: maxU}, (_, i) =>
                `<div class="streak-use-dot ${i < uses ? 'used' : ''}"></div>`).join('');
            el.innerHTML = `
            <div class="streak-pause-item">
                <div class="streak-pause-info">
                    <div class="streak-pause-name">${escapeHtml(act.name)}</div>
                    <div class="streak-pause-meta">${escapeHtml(act.dimName)} › ${escapeHtml(act.pathName)} · ${streakLabel(act)}</div>
                </div>
                <div class="streak-pause-uses" title="${uses}/${maxU} shields used">${dotsHtml}</div>
                ${isPaused
                    ? `<span class="streak-paused-badge">Paused</span>`
                    : `<button class="btn-pause-streak" ${uses >= maxU ? 'disabled title="No shields left"' : ''} onclick="pauseStreak('${act.id}')">Use Shield</button>`
                }
            </div>
            <p class="settings-note" style="margin-top:10px;">${uses}/${maxU} shields used for this activity.</p>`;
        };

        window.pauseStreak = async function(actId) {
            let activity = null;
            (window.userData.dimensions || []).forEach(dim =>
                (dim.paths || []).forEach(path =>
                    (path.activities || []).forEach(act => { if (act.id === actId) activity = act; })));
            if (!activity) return;
            const uses = activity.streakPauseUses || 0;
            if (uses >= 3) return;
            if (!confirm(`Pause streak for "${activity.name}"? This will protect your streak for 1 day. You have ${3 - uses} shield${3 - uses !== 1 ? 's' : ''} remaining.`)) return;
            if (activity.isNegative || activity.frequency === 'occasional') return;
            activity.streakPaused = true;
            activity.streakPauseUses = uses + 1;
            activity.streakPausedAt = new Date().toISOString();
            await saveUserData();
            renderStreakPauseList();
            showToast(`🛡 Streak paused for "${activity.name}"`, 'olive');
        };

        // processStreakPauses — called on login to reset any manual pause flags.
        // Auto-shield consumption happens in consumeStreakShields() (write path only).
        async function processStreakPauses() {
            const today = new Date().toISOString().split('T')[0];
            let anyChanged = false;
            (window.userData.dimensions || []).forEach(dim =>
                (dim.paths || []).forEach(path =>
                    (path.activities || []).forEach(act => {
                        // Expire manual pause after 1 day
                        if (act.streakPaused && act.streakPausedAt) {
                            const pausedDay = act.streakPausedAt.split('T')[0];
                            if (pausedDay !== today) {
                                act.streakPaused = false;
                                anyChanged = true;
                            }
                        }
                        // Skip-penalty: returns true if XP was deducted
                        if (processSkipPenalty(act, today)) anyChanged = true;
                    })));
            // Persist any changes (penalties OR expired pauses) to Firestore
            if (anyChanged) {
                try { await saveUserData(); } catch(e) { console.warn('processStreakPauses save failed', e); }
            }
        }

        // ── wasCompletedOnDay ─────────────────────────────────────────────
        // Returns true if the activity has a positive-XP completion on the given Date object.
        // Uses completionHistory (preferred) or falls back to lastCompleted.
        function wasCompletedOnDay(activity, dateObj) {
            const dayStr = dateObj.toDateString();
            if (activity.completionHistory && activity.completionHistory.length > 0) {
                return activity.completionHistory.some(e =>
                    (e.xp || 0) > 0 && e.date && new Date(e.date).toDateString() === dayStr
                );
            }
            // Fallback for old data without completionHistory
            return !!(activity.lastCompleted && new Date(activity.lastCompleted).toDateString() === dayStr);
        }

        // ── processSkipPenalty ────────────────────────────────────────────
        // Called on every login / page load via processStreakPauses().
        //   • Runs for any isSkipNegative activity (daily, weekly, monthly).
        //   • Only runs once per calendar day (idempotent via lastSkipCheckDate).
        //   • Scans every expected cycle from last check up to yesterday inclusive.
        //   • Missed cycles capped at 7. Penalty = missedCount × baseXP (linear).
        //   • One shield consumed per missed cycle; streak breaks when shields gone.
        //   • Returns true if a penalty was applied (so caller knows to save).
        function processSkipPenalty(activity, today) {
            if (!activity.isSkipNegative) return false;

            // Already processed today — nothing to do
            if (activity.lastSkipCheckDate === today) return false;

            // Cycle length in days depending on frequency
            const freq = activity.frequency || 'daily';
            const cycleDays = freq === 'weekly' ? 7 : freq === 'monthly' ? 30 : 1;

            // Determine the most recent real (positive-XP) completion as our origin.
            // NEVER use new Date(null) — that gives Jan 1 1970 and causes a runaway
            // penalty scan spanning thousands of days.
            let lastPositiveDate = null;
            const posEntries = (activity.completionHistory || []).filter(e => (e.xp || 0) > 0);
            if (posEntries.length > 0) {
                lastPositiveDate = new Date(posEntries[posEntries.length - 1].date);
            } else if (activity.lastCompleted) {
                lastPositiveDate = new Date(activity.lastCompleted);
            }

            // Guard: never penalise a brand-new activity with no completion history
            if (!lastPositiveDate || isNaN(lastPositiveDate.getTime())) {
                activity.lastSkipCheckDate = today;
                return false;
            }

            const todayMidnight = new Date(today + 'T00:00:00');

            // Determine scan start:
            //   • If we have run before (prevCheckStr exists), resume from that day —
            //     the user may have missed it.
            //   • Otherwise start the day after the last positive completion.
            const prevCheckStr = activity.lastSkipCheckDate;
            let startDay;
            if (prevCheckStr) {
                startDay = new Date(prevCheckStr + 'T00:00:00');
            } else {
                const ref = new Date(lastPositiveDate); ref.setHours(0,0,0,0);
                startDay = new Date(ref);
                startDay.setDate(startDay.getDate() + cycleDays);
            }
            startDay.setHours(0, 0, 0, 0);

            // Stamp today BEFORE scanning so re-entry is blocked even on early return
            activity.lastSkipCheckDate = today;

            const todayMidnightMs = todayMidnight.getTime();
            let missedCycles = 0;
            const cursor = new Date(startDay);
            while (cursor.getTime() < todayMidnightMs) {
                if (!wasCompletedOnDay(activity, cursor)) missedCycles++;
                cursor.setDate(cursor.getDate() + cycleDays);
            }
            missedCycles = Math.min(7, missedCycles);

            if (missedCycles === 0) {
                activity.skipStreak = 0;
                return false;
            }

            // Accumulate skip streak
            activity.skipStreak = (activity.skipStreak || 0) + missedCycles;

            // Shield consumption
            const MAX_SHIELDS = 3;
            const usedShields = activity.streakPauseUses || 0;
            const availableShields = Math.max(0, MAX_SHIELDS - usedShields);
            const shieldsToConsume = Math.min(missedCycles, availableShields);
            activity.streakPauseUses = Math.min(MAX_SHIELDS, usedShields + shieldsToConsume);

            // Break streak if missed cycles exceeded available shields
            if (missedCycles > availableShields) {
                activity.streak = 0;
                activity.streakPauseUses = 0;
                activity.streakPaused = false;
            }

            // XP Penalty
            const totalPenalty = (activity.baseXP || 10) * missedCycles;
            window.userData.currentXP -= totalPenalty;
            window.userData.totalXP   -= totalPenalty;

            // Level-down if needed
            while (window.userData.currentXP < 0 && window.userData.level > 1) {
                window.userData.level -= 1;
                window.userData.currentXP += calculateXPForLevel(window.userData.level);
            }
            if (window.userData.currentXP < 0) window.userData.currentXP = 0;

            // Record in history
            recordCompletion(activity, -totalPenalty, true);

            // Apply to parent dimension
            const _penDim = findDimForActivity(activity.id);
            if (_penDim) applyDimXP(_penDim, -totalPenalty);

            // Store context for the "missed penalty" UI tag
            activity.lastPenaltyDate = today;
            activity.lastPenaltyDays = missedCycles;

            return true; // caller must save
        }

        // ── Auto-Backup ────────────────────────────────────────────────────
        // Daily backup is now folded into saveUserData() above (zero extra writes).
        // saveAutoBackup() kept as a no-op stub so any stale call sites don't throw.
        async function saveAutoBackup() { /* no-op: logic moved to saveUserData */ }

        async function updateRestoreBackupBtn(knownDate) {
            const btn = document.getElementById('restoreBackupBtn');
            const metaEl = document.getElementById('restoreBackupMeta');
            if (!btn || !metaEl) return;
            btn.disabled = false;
            btn.style.opacity = '1';
            try {
                const dateStr = knownDate || (window.userData && window.userData.autoBackup && window.userData.autoBackup.savedDate) || null;
                metaEl.textContent = dateStr ? 'Saved: ' + dateStr : 'No backup yet';
            } catch(e) {
                metaEl.textContent = 'Check for backup';
            }
        }

        window.restoreAutoBackup = async function() {
            if (!window.currentUser) return;
            try {
                // Read from inline autoBackup field in user's main doc
                const backup = window.userData.autoBackup;
                if (!backup || !backup.data) {
                    showToast('No backup found. Complete an activity to create one.', 'red');
                    return;
                }
                const { savedDate, data } = backup;
                if (!confirm('Restore the backup from ' + savedDate + '? This will replace your current data. Continue?')) return;
                window.userData = data;
                processStreakPauses();
                // Reset backup gate so saveUserData immediately embeds a fresh
                // snapshot of the restored data (otherwise button shows "No backup yet")
                _backupSavedDate = null;
                await saveUserData();
                updateDashboard();
                showToast('\uD83D\uDD04 Data restored from ' + savedDate, 'olive');
            } catch(e) {
                alert('Restore failed: ' + e.message);
            }
        };
        // ── Import / Export / Reset ───────────────────────────────────────

        window.exportData = function() {
            const blob = new Blob([JSON.stringify(window.userData, null, 2)], { type: 'application/json' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = `levelup-backup-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('⬆️ Data exported!', 'green');
        };

        window.importData = async function(event) {
            const file = event.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const parsed = JSON.parse(text);
                // Basic validation
                if (!parsed.dimensions && !parsed.level) throw new Error('Invalid data format');
                if (!confirm('This will REPLACE all your current data with the imported file. Continue?')) {
                    event.target.value = '';
                    return;
                }
                window.userData = parsed;
                processStreakPauses();
                _backupSavedDate = null; // force fresh backup snapshot on this save
                await saveUserData();
                updateDashboard();
                showToast('⬇️ Data imported!', 'blue');
            } catch(e) {
                alert('Failed to import: ' + e.message);
            }
            event.target.value = '';
        };

        window.confirmResetData = function() {
            const first = confirm('⚠️ This will permanently delete ALL your data — activities, XP, challenges, rewards, everything. This cannot be undone.\n\nAre you absolutely sure?');
            if (!first) return;
            const second = confirm('Last chance! Type "RESET" in the next dialog to confirm.');
            const word = prompt('Type RESET to confirm:');
            if (word !== 'RESET') { alert('Reset cancelled.'); return; }
            window.userData = {
                level: 1, currentXP: 0, totalXP: 0,
                dimensions: [], activities: [], challenges: [], rewards: {},
                settings: window.userData.settings || {},
                createdAt: new Date().toISOString()
            };
            saveUserData().then(() => { updateDashboard(); showToast('🗑️ All data cleared.', 'red'); });
        };

        // ── Generic Toast ─────────────────────────────────────────────────

        function showToast(message, color = 'blue') {
            const map = { blue:'var(--color-accent-blue)', green:'var(--color-accent-green)',
                          olive:'var(--color-accent-olive)', red:'var(--color-accent-red)' };
            const toast = document.createElement('div');
            toast.style.cssText = `position:fixed;top:100px;right:20px;background:${map[color]||map.blue};
                color:#fff;padding:14px 22px;border-radius:12px;font-weight:600;font-size:15px;
                z-index:10000;box-shadow:0 8px 24px rgba(0,0,0,0.4);animation:slideIn 0.3s ease;`;
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => { toast.style.animation='slideOut 0.3s ease'; setTimeout(()=>toast.remove(),300); }, 3000);
        }

        // Auth Functions
        


        window.handleGoogleSignIn = async function() {
            hideError();
            const btn = document.getElementById('googleBtn');
            const spinner = document.getElementById('googleSpinner');
            const icon = document.getElementById('googleIcon');
            const text = document.getElementById('googleBtnText');
            // Show loading state
            btn.disabled = true;
            spinner.style.display = 'block';
            icon.style.display = 'none';
            text.textContent = 'Signing in…';
            const provider = new GoogleAuthProvider();
            try {
                await signInWithPopup(auth, provider);
                // onAuthStateChanged will handle the transition — keep spinner showing
            } catch (error) {
                // Reset button on error
                btn.disabled = false;
                spinner.style.display = 'none';
                icon.style.display = 'block';
                text.textContent = 'Continue with Google';
                showError(getErrorMessage(error.code));
            }
        };

        window.handleLogout = async function() {
            try {
                await signOut(auth);
            } catch (error) {
                console.error('Logout error:', error);
            }
        };

        // Error Handling
        function showError(message) {
            const errorDiv = document.getElementById('authError');
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
        }

        function hideError() {
            const errorDiv = document.getElementById('authError');
            errorDiv.style.display = 'none';
        }

        function getErrorMessage(errorCode) {
            const errorMessages = {
                'auth/email-already-in-use': 'This email is already registered',
                'auth/invalid-email': 'Invalid email address',
                'auth/operation-not-allowed': 'Operation not allowed',
                'auth/weak-password': 'Password should be at least 6 characters',
                'auth/user-disabled': 'This account has been disabled',
                'auth/user-not-found': 'No account found with this email',
                'auth/wrong-password': 'Incorrect password',
                'auth/invalid-credential': 'Invalid email or password',
                'auth/popup-closed-by-user': 'Sign-in popup was closed'
            };
            
            return errorMessages[errorCode] || 'An error occurred. Please try again.';
        }

        // Make auth available globally
        window.firebaseAuth = auth;
        window.firebaseDb = db;

        // ── PWA Install Prompt ────────────────────────────────────────────────
        // Catches the browser's beforeinstallprompt event, holds it, then shows
        // a tasteful banner 3 seconds after login. Dismissed state is stored in
        // localStorage for 7 days so we don't nag returning users.

        (function() {
            var _deferredPrompt = null;
            var SNOOZE_KEY = 'mk_install_snoozed';
            var SNOOZE_DAYS = 7;

            function isSnoozed() {
                try {
                    var ts = localStorage.getItem(SNOOZE_KEY);
                    if (!ts) return false;
                    var age = (Date.now() - parseInt(ts)) / (1000 * 60 * 60 * 24);
                    return age < SNOOZE_DAYS;
                } catch(e) { return false; }
            }

            function snooze() {
                try { localStorage.setItem(SNOOZE_KEY, Date.now().toString()); } catch(e) {}
            }

            function isInstalled() {
                return window.matchMedia('(display-mode: standalone)').matches ||
                       window.navigator.standalone === true;
            }

            function showBanner() {
                var banner = document.getElementById('pwaInstallBanner');
                if (!banner) return;
                banner.style.display = 'flex';
                document.body.classList.add('pwa-banner-visible');
            }

            function hideBanner() {
                var banner = document.getElementById('pwaInstallBanner');
                if (!banner) return;
                banner.style.display = 'none';
                document.body.classList.remove('pwa-banner-visible');
            }

            // Capture the install prompt early
            window.addEventListener('beforeinstallprompt', function(e) {
                e.preventDefault();
                _deferredPrompt = e;
            });

            // Show banner 3s after app loads (if eligible)
            window.addEventListener('load', function() {
                setTimeout(function() {
                    if (isInstalled()) return;
                    if (isSnoozed()) return;
                    if (!_deferredPrompt) return;
                    showBanner();
                }, 3000);
            });

            // Install button
            document.addEventListener('click', function(e) {
                if (!e.target.closest('#pwaInstallBtn')) return;
                hideBanner();
                if (!_deferredPrompt) return;
                _deferredPrompt.prompt();
                _deferredPrompt.userChoice.then(function(result) {
                    if (result.outcome === 'accepted') {
                        snooze(); // no need to show again
                    }
                    _deferredPrompt = null;
                });
            });

            // Dismiss button — snooze for 7 days
            document.addEventListener('click', function(e) {
                if (!e.target.closest('#pwaInstallDismiss')) return;
                hideBanner();
                snooze();
            });
        })();

        // ── Daily Reminder Notifications ──────────────────────────────────────
        // VAPID public key — paste your generated key here after running vapid-keygen.html
        var VAPID_PUBLIC_KEY = 'BCsaPZ-4JC3l8b_bSvbQO4PZpq_x3cj6lkEJ_y-F9mnp24tB469h-D1UIhlV5k_-4h2l3Nv1L4__GZIdutiSmuw';

        // Convert VAPID base64 URL key to Uint8Array (required by PushManager)
        function urlBase64ToUint8Array(base64String) {
            var padding = '='.repeat((4 - base64String.length % 4) % 4);
            var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
            var rawData = atob(base64);
            var arr = new Uint8Array(rawData.length);
            for (var i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i);
            return arr;
        }

        // Subscribe user to Web Push and save subscription + reminder time to Firestore
        async function subscribeToPush(localTime) {
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
            if (VAPID_PUBLIC_KEY === 'PASTE_YOUR_VAPID_PUBLIC_KEY_HERE') {
                console.warn('VAPID public key not configured — push notifications disabled');
                return false;
            }
            try {
                var reg = await navigator.serviceWorker.ready;
                var sub = await reg.pushManager.getSubscription();
                if (!sub) {
                    sub = await reg.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
                    });
                }
                var subJson = sub.toJSON();
                // Store UTC offset so the server can convert local time → UTC for scheduling
                window.userData.pushSubscription = {
                    endpoint: subJson.endpoint,
                    keys: subJson.keys,
                    reminderTime: localTime,
                    tzOffset: new Date().getTimezoneOffset() // minutes behind UTC
                };
                await saveUserData();
                return true;
            } catch (err) {
                console.error('Push subscription failed:', err);
                return false;
            }
        }

        // Unsubscribe from Web Push and remove from Firestore
        async function unsubscribeFromPush() {
            try {
                if ('serviceWorker' in navigator) {
                    var reg = await navigator.serviceWorker.ready;
                    var sub = await reg.pushManager.getSubscription();
                    if (sub) await sub.unsubscribe();
                }
                if (window.userData && window.userData.pushSubscription) {
                    delete window.userData.pushSubscription;
                    await saveUserData();
                }
            } catch (err) {
                console.error('Unsubscribe failed:', err);
            }
        }

        // Fallback: in-tab interval check (fires if browser is open, no push infrastructure needed)
        let _reminderInterval = null;
        function scheduleReminder() {
            var time = localStorage.getItem('reminderTime');
            // Guard: iOS Safari does not expose the Notification API at all
            if (!time || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
            if (_reminderInterval) clearInterval(_reminderInterval);
            function checkAndNotify() {
                var now = new Date();
                var parts = time.split(':');
                var h = parseInt(parts[0], 10);
                var m = parseInt(parts[1], 10);
                if (now.getHours() === h && now.getMinutes() === m) {
                    var todayKey = now.toISOString().slice(0, 10);
                    var lastSent = localStorage.getItem('reminderLastSent');
                    if (lastSent !== todayKey) {
                        new Notification('Mindkraft ⚔️', {
                            body: "Don't forget to check off today's tasks!",
                            icon: './icon-192.svg'
                        });
                        localStorage.setItem('reminderLastSent', todayKey);
                    }
                }
            }
            checkAndNotify();
            _reminderInterval = setInterval(checkAndNotify, 60000);
        }

        window.saveReminder = async function() {
            if (typeof Notification === 'undefined' || !('Notification' in window)) {
                showToast('Notifications not supported in this browser', 'red');
                return;
            }
            // Request permission if not yet decided
            if (Notification.permission === 'default') {
                var perm = await Notification.requestPermission();
                var statusEl = document.getElementById('reminderPermStatus');
                if (statusEl) statusEl.textContent = perm === 'granted'
                    ? '✅ Permission granted'
                    : '❌ Permission denied — please allow notifications in your browser settings.';
                if (perm !== 'granted') return;
            }
            if (Notification.permission === 'denied') {
                showToast('Notifications blocked — please allow them in browser settings', 'red');
                return;
            }
            var time = document.getElementById('reminderTime').value;
            if (!time) { showToast('Please pick a time first', 'red'); return; }

            localStorage.setItem('reminderTime', time);

            // Try push first (works even when browser is closed/in background)
            var pushOk = await subscribeToPush(time);

            // Always run the in-tab fallback too (belt and suspenders)
            scheduleReminder();

            var statusEl = document.getElementById('reminderPermStatus');
            if (pushOk) {
                if (statusEl) statusEl.textContent = '✅ Push reminder set for ' + time + ' — works even when browser is closed.';
                showToast('Push reminder set for ' + time + ' ✅', 'green');
            } else {
                if (statusEl) statusEl.textContent = '⚠️ In-tab reminder set for ' + time + '. Push not available — needs VAPID key configured.';
                showToast('Reminder set for ' + time + ' (browser must be open) ✅', 'green');
            }
        };

        window.clearReminder = async function() {
            localStorage.removeItem('reminderTime');
            localStorage.removeItem('reminderLastSent');
            if (_reminderInterval) { clearInterval(_reminderInterval); _reminderInterval = null; }
            await unsubscribeFromPush();
            var el = document.getElementById('reminderTime');
            if (el) el.value = '';
            var statusEl = document.getElementById('reminderPermStatus');
            if (statusEl) statusEl.textContent = '';
            showToast('Reminder cleared', 'red');
        };

        window.toggleReminder = function() {
            var body = document.getElementById('reminderBody');
            var btn  = document.getElementById('reminderToggleBtn');
            if (!body) return;
            var isOpen = body.classList.toggle('open');
            if (btn) btn.classList.toggle('open', isOpen);
            if (isOpen) {
                // Populate saved time
                var saved = localStorage.getItem('reminderTime');
                var timeEl = document.getElementById('reminderTime');
                if (timeEl && saved) timeEl.value = saved;
                // Show status
                var statusEl = document.getElementById('reminderPermStatus');
                if (!statusEl) return;
                var hasPush = window.userData && window.userData.pushSubscription;
                if (!('Notification' in window)) {
                    statusEl.textContent = '⚠️ Notifications not supported in this browser.';
                } else if (Notification.permission === 'denied') {
                    statusEl.textContent = '❌ Notifications blocked. Allow them in your browser/OS settings.';
                } else if (hasPush && saved) {
                    statusEl.textContent = '✅ Push reminder active at ' + saved + ' — fires even when browser is closed.';
                } else if (saved) {
                    statusEl.textContent = '⚠️ In-tab reminder active at ' + saved + '. Re-save after adding VAPID key for push support.';
                } else {
                    statusEl.textContent = Notification.permission === 'granted'
                        ? '✅ Notifications allowed. Pick a time and save.'
                        : "You'll be asked to allow notifications when you save.";
                }
            }
        };
