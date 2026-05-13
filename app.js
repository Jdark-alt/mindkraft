        import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
        import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
        import { getFirestore, doc, getDoc, getDocFromCache, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
        import { getAnalytics, logEvent } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js';

        // Firebase Configuration
        const firebaseConfig = {
            apiKey: "AIzaSyCLVITDz6EkpSNS1XMuIvRaKEmDNN_h_Eg",
            authDomain: "life-gamification-app-b7674.firebaseapp.com",
            projectId: "life-gamification-app-b7674",
            storageBucket: "life-gamification-app-b7674.firebasestorage.app",
            messagingSenderId: "204483721645",
            appId: "1:204483721645:web:43192b9596feffbd888924",
            measurementId: "G-PY6TQTYEZP"
        };

        // Initialize Firebase
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
        const analytics = getAnalytics(app);

        // ── Analytics ─────────────────────────────────────────────────────
        // Central wrapper — add PostHog or other tools here later, one line each
        window.trackEvent = function(eventName, params = {}) {
            try { logEvent(analytics, eventName, params); } catch(e) {}
        };

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

        // Aggregate activity XP by profile spider tags (independent of dimension lifeCategory)
        function getProfileCategoryXP() {
            const map = {};
            window.LIFE_CATEGORIES.forEach(c => { map[c.id] = 0; });
            const tags = (window.userData.profile && window.userData.profile.spiderTags) || {};
            (window.userData.dimensions || []).forEach(dim => {
                (dim.paths || []).forEach(path => {
                    (path.activities || []).forEach(act => {
                        const cat = tags[act.id];
                        if (cat && map.hasOwnProperty(cat)) {
                            // Sum from completionHistory for accuracy
                            const histXP = (act.completionHistory || [])
                                .filter(e => !e.isPenalty)
                                .reduce((s, e) => s + (e.xp || 0), 0);
                            map[cat] += histXP || act.totalXP || 0;
                        }
                    });
                });
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

        // ── Friend Code helpers ───────────────────────────────────────────
        function generateFriendCode() {
            // Unambiguous charset — no I, O, 0, 1 to avoid confusion
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let code = 'MK-';
            for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
            return code;
        }

        // XP earned Mon-Sun of the current week (ISO Mon start)
        // Week runs Sun–Sat (matching activity reset cadence)
        function getWeekStartStr() {
            // Use local-time day-of-week so the cycle always resets at midnight Sunday
            // in the user's own timezone. Previously used toISOString() (UTC) which caused
            // the week to appear to reset on Saturday for UTC+ users (e.g. India UTC+5:30).
            const now = new Date();
            const sunday = new Date(now);
            sunday.setHours(0, 0, 0, 0);
            sunday.setDate(sunday.getDate() - now.getDay()); // getDay()==0 on Sun → no change
            const y = sunday.getFullYear();
            const m = String(sunday.getMonth() + 1).padStart(2, '0');
            const d = String(sunday.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }

        function computeWeeklyXP() {
            const weekStartStr = getWeekStartStr();
            let xp = 0;
            (window.userData.dimensions || []).forEach(dim =>
                (dim.paths || []).forEach(path =>
                    (path.activities || []).forEach(act => {
                        (act.completionHistory || []).forEach(e => {
                            if (!e.isPenalty && e.date && toLocalDateStr(new Date(e.date)) >= weekStartStr) xp += (e.xp || 0);
                        });
                    })
                )
            );
            return xp;
        }

        // Week label = the ISO date of this week's Sunday — resets every Sun at midnight
        function getISOWeekLabel() {
            return getWeekStartStr(); // e.g. "2026-04-06"
        }

        function computeXPPerHour(activities) {
            const yStr = localYesterday();
            let xp = 0;
            activities.forEach(act => {
                (act.completionHistory || []).forEach(e => {
                    if (!e.isPenalty && e.date && toLocalDateStr(new Date(e.date)) === yStr) xp += (e.xp || 0);
                });
            });
            return Math.round((xp / 12) * 10) / 10;
        }

        // Weekly XP scoped to a given activities array (for analytics filters).
        function computeWeeklyXPFromActivities(activities) {
            const weekStartStr = getWeekStartStr();
            let xp = 0;
            activities.forEach(act => {
                (act.completionHistory || []).forEach(e => {
                    if (!e.isPenalty && e.date && toLocalDateStr(new Date(e.date)) >= weekStartStr) xp += (e.xp || 0);
                });
            });
            return xp;
        }

        // Write a lean public snapshot to publicProfiles/{uid} - called inside saveUserData.
        // Failures are swallowed so they never block a private save.
        async function syncPublicProfile() {
            if (!window.currentUser || !window.userData) return;
            try {
                const catXP   = getProfileCategoryXP();
                const level   = window.userData.level || 1;
                const title   = getCharacterTitle(level, catXP);
                const allActs = [];
                (window.userData.dimensions || []).forEach(dim =>
                    (dim.paths || []).forEach(path =>
                        (path.activities || []).forEach(act => allActs.push(act))));
                const bestStreak = allActs.reduce((m, a) => Math.max(m, a.bestStreak || a.streak || 0), 0);
                const daySet = new Set();
                allActs.forEach(act =>
                    (act.completionHistory || []).forEach(e => {
                        if (!e.isPenalty && e.date) daySet.add(e.date.slice(0, 10));
                    })
                );
                const todayStr = localToday();
                const xpTodayVal = allActs.reduce((s, a) =>
                    s + (a.completionHistory || [])
                        .filter(e => !e.isPenalty && e.date && toLocalDateStr(new Date(e.date)) === todayStr)
                        .reduce((xs, e) => xs + (e.xp || 0), 0)
                , 0) + ((window.userData.xpTodayGhost || {})[todayStr] || 0);
                const profile = window.userData.profile || {};
                const user    = window.currentUser;
                const publicData = {
                    displayName:    profile.username || user.displayName || 'Adventurer',
                    photoURL:       user.photoURL || null,
                    friendCode:     window.userData.friendCode || null,
                    level:          level,
                    totalXP:        (window.userData.totalXP || 0) + (window.userData.xpDeletedGhost || 0),
                    weeklyXP:       computeWeeklyXP(),
                    weeklyXPWeek:   getISOWeekLabel(),
                    xpPerHour:      computeXPPerHour(allActs),
                    xpPerHourDate:  localYesterday(),
                    categoryXP:     catXP,
                    characterTitle: title,
                    bestStreak:     bestStreak,
                    activeDays:     daySet.size,
                    xpToday:        xpTodayVal,
                    xpTodayDate:    todayStr,
                    updatedAt:      new Date().toISOString()
                };
                const pubRef = doc(db, 'publicProfiles', user.uid);
                await setDoc(pubRef, publicData);
            } catch (e) {
                console.warn('Public profile sync failed (non-critical):', e);
            }
        }

        // Top activities since levelStartedAt
        function getTopActivitiesThisLevel() {
            const levelStart = window.userData.cardLevelStartedAt
                ? new Date(window.userData.cardLevelStartedAt)
                : window.userData.levelStartedAt
                    ? new Date(window.userData.levelStartedAt)
                    : null;
            const actXP = [];
            (window.userData.dimensions || []).forEach(dim => {
                (dim.paths || []).forEach(path => {
                    (path.activities || []).forEach(act => {
                        let xp = 0;
                        if (levelStart) {
                            // Filter to completions since this level started
                            (act.completionHistory || []).forEach(e => {
                                if (e.isPenalty) return;
                                if (new Date(e.date) < levelStart) return;
                                xp += Math.abs(e.xp || 0);
                            });
                        } else {
                            // No levelStartedAt yet — fall back to all-time totalXP per activity
                            xp = act.totalXP || 0;
                        }
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

        // Category XP filtered to completions since a given Date — used by the share card
        // so "Most Active Areas" reflects this level, not all-time
        function getCategoryXPSince(levelStart) {
            const map = {};
            window.LIFE_CATEGORIES.forEach(c => { map[c.id] = 0; });
            if (!levelStart) return map; // no timestamp — caller will handle fallback
            (window.userData.dimensions || []).forEach(dim => {
                const cat = dim.lifeCategory;
                if (!cat || !map.hasOwnProperty(cat)) return;
                (dim.paths || []).forEach(path => {
                    (path.activities || []).forEach(act => {
                        (act.completionHistory || []).forEach(e => {
                            if (e.isPenalty) return;
                            if (new Date(e.date) < levelStart) return;
                            map[cat] += Math.abs(e.xp || 0);
                        });
                    });
                });
            });
            return map;
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
            const W = 540, H = 960;
            const canvas = document.createElement('canvas');
            canvas.width = W; canvas.height = H;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Canvas 2D context unavailable');

            // ── Theme colors ──
            const root  = getComputedStyle(document.documentElement);
            const uAcc  = root.getPropertyValue('--color-accent-blue').trim()  || '#4a7c9e';
            const uProg = root.getPropertyValue('--color-progress').trim()      || '#5a9fd4';
            const uRed  = root.getPropertyValue('--color-accent-red').trim()    || '#8e3b5f';
            const uOlv  = root.getPropertyValue('--color-accent-olive').trim()  || '#7a7b4d';
            const uGrn  = root.getPropertyValue('--color-accent-green').trim()  || '#6b7c3f';

            function hexRgb(h) {
                h = (h||'#000').replace('#','');
                if (h.length===3) h=h.split('').map(c=>c+c).join('');
                const n=parseInt(h,16);
                return [(n>>16)&255,(n>>8)&255,n&255];
            }
            function rgba(hex,a){ const [r,g,b]=hexRgb(hex); return `rgba(${r},${g},${b},${a})`; }
            function rr(x,y,w,h,r){
                ctx.beginPath();
                ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
                ctx.quadraticCurveTo(x+w,y,x+w,y+r);
                ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
                ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
                ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
                ctx.closePath();
            }
            function hline(y,a){
                ctx.save();
                const g=ctx.createLinearGradient(PAD,y,W-PAD,y);
                g.addColorStop(0,'transparent');
                g.addColorStop(0.3,rgba(uAcc,a||0.28));
                g.addColorStop(0.7,rgba(uProg,a||0.28));
                g.addColorStop(1,'transparent');
                ctx.strokeStyle=g; ctx.lineWidth=0.5;
                ctx.beginPath(); ctx.moveTo(PAD,y); ctx.lineTo(W-PAD,y); ctx.stroke();
                ctx.restore();
            }
            function glow(x,y,r,hex,a){
                ctx.save(); ctx.globalAlpha=a;
                const g=ctx.createRadialGradient(x,y,0,x,y,r);
                g.addColorStop(0,hex); g.addColorStop(1,'transparent');
                ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
                ctx.restore();
            }
            function sf(w,sz){ return `${w} ${sz}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif`; }

            const PAD = 34;

            // ════════════════════════════════════════
            // BACKGROUND
            // ════════════════════════════════════════
            ctx.fillStyle = '#0c0c10'; ctx.fillRect(0,0,W,H);
            glow(100, 200, 300, uAcc,  0.16);
            glow(440, 720, 260, uRed,  0.11);
            glow(270, 480, 180, uProg, 0.09);

            ctx.save();
            ctx.strokeStyle = rgba(uAcc, 0.055); ctx.lineWidth = 0.5;
            for (let i=-H; i<W+H; i+=58){
                ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i+H,H); ctx.stroke();
            }
            ctx.restore();

            // ════════════════════════════════════════
            // SECTION 1 — Brand (compact)
            // ════════════════════════════════════════
            const brandY = 56;
            // icon circle
            ctx.save();
            const ig=ctx.createRadialGradient(W/2,brandY,0,W/2,brandY,28);
            ig.addColorStop(0,rgba(uProg,0.22)); ig.addColorStop(1,rgba(uAcc,0.05));
            ctx.beginPath(); ctx.arc(W/2,brandY,28,0,Math.PI*2);
            ctx.fillStyle=ig; ctx.fill();
            ctx.strokeStyle=rgba(uAcc,0.25); ctx.lineWidth=0.75; ctx.stroke();
            ctx.restore();
            ctx.font='32px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
            ctx.fillText('\uD83E\uDDE0', W/2, brandY);
            ctx.textBaseline='alphabetic';
            ctx.font=sf(800,27); ctx.textAlign='center';
            const bng=ctx.createLinearGradient(W/2-110,0,W/2+110,0);
            bng.addColorStop(0,'#fff'); bng.addColorStop(1,uProg);
            ctx.fillStyle=bng; ctx.fillText('Mindkraft', W/2, brandY+40);
            ctx.font=sf(400,12); ctx.fillStyle='rgba(176,176,176,0.55)';
            ctx.fillText('Gamify your life.', W/2, brandY+58);
            hline(brandY+72, 0.3);

            // ════════════════════════════════════════
            // SECTION 2 — LEVEL hero (larger, centered)
            // ════════════════════════════════════════
            const heroTop = brandY + 90;

            // "LEVEL" label
            ctx.font = sf(400, 22);
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.textAlign = 'center';
            ctx.fillText('LEVEL', W/2, heroTop + 24);

            // Level number — bigger than before
            glow(W/2, heroTop+80, 140, uProg, 0.13);
            const numFS = newLevel >= 100 ? 130 : 158;
            ctx.font = sf(800, numFS);
            ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            const ng = ctx.createLinearGradient(W/2, heroTop+34, W/2, heroTop+34+numFS);
            ng.addColorStop(0,'#ffffff'); ng.addColorStop(0.45,uProg); ng.addColorStop(1,uAcc);
            ctx.fillStyle = ng;
            ctx.fillText(String(newLevel), W/2, heroTop + 34);
            ctx.textBaseline = 'alphabetic';

            // Character title pill
            const catXP = getCategoryXP();
            const charTitle = getCharacterTitle(newLevel, catXP);
            const titleY = heroTop + 34 + numFS + 18;
            ctx.font = sf(600, 16);
            ctx.textAlign = 'center';
            const ctW = Math.min(ctx.measureText(charTitle).width + 48, 280);
            ctx.save();
            rr(W/2-ctW/2, titleY-20, ctW, 32, 16);
            ctx.fillStyle=rgba(uProg,0.13); ctx.fill();
            ctx.strokeStyle=rgba(uProg,0.38); ctx.lineWidth=0.75; ctx.stroke();
            ctx.restore();
            ctx.fillStyle = uProg; ctx.fillText(charTitle, W/2, titleY);

            hline(titleY + 20, 0.25);

            // ════════════════════════════════════════
            // SECTION 3 — Progress bar + XP label
            // (below character title)
            // ════════════════════════════════════════
            const barTop = titleY + 38;
            const barH   = 22;
            const barW   = W - PAD*2;

            // Bar track
            ctx.save(); rr(PAD, barTop, barW, barH, barH/2);
            ctx.fillStyle='rgba(255,255,255,0.06)'; ctx.fill(); ctx.restore();

            // Bar fill — full, gradient with motion shimmer
            const fillG = ctx.createLinearGradient(PAD, barTop, PAD+barW, barTop);
            fillG.addColorStop(0,   uAcc);
            fillG.addColorStop(0.4, uProg);
            fillG.addColorStop(0.75,'#8ecff0');
            fillG.addColorStop(1,   '#c8ebfa');
            ctx.save(); rr(PAD, barTop, barW, barH, barH/2);
            ctx.fillStyle=fillG; ctx.fill();
            // motion shimmer: diagonal light sweep
            ctx.clip();
            const sh = ctx.createLinearGradient(PAD, barTop, PAD+barW, barTop+barH);
            sh.addColorStop(0,   'rgba(255,255,255,0)');
            sh.addColorStop(0.35,'rgba(255,255,255,0.18)');
            sh.addColorStop(0.65,'rgba(255,255,255,0.07)');
            sh.addColorStop(1,   'rgba(255,255,255,0)');
            ctx.fillStyle=sh; ctx.fillRect(PAD, barTop, barW, barH);
            ctx.restore();

            // Arrow chevrons on bar (→→ directionality)
            ctx.save(); ctx.globalAlpha=0.22; ctx.strokeStyle='#fff'; ctx.lineWidth=1.5;
            ctx.lineJoin='round'; ctx.lineCap='round';
            const chevW=10, chevH=8, chevGap=28;
            for (let cx2 = PAD+chevGap; cx2 < PAD+barW-chevGap; cx2+=chevGap) {
                const cy2 = barTop + barH/2;
                ctx.beginPath();
                ctx.moveTo(cx2-chevW/2, cy2-chevH/2);
                ctx.lineTo(cx2+chevW/2, cy2);
                ctx.lineTo(cx2-chevW/2, cy2+chevH/2);
                ctx.stroke();
            }
            ctx.restore();

            // L(prev) ←···XP label···→ L(current) row
            // Use cardLevelStartedAt (start of the level just completed) for card stats.
            // Falls back to levelStartedAt, then null.
            const levelStart = window.userData.cardLevelStartedAt
                ? new Date(window.userData.cardLevelStartedAt)
                : window.userData.levelStartedAt
                    ? new Date(window.userData.levelStartedAt)
                    : null;
            let xpThisLevel = 0;
            if (levelStart) {
                (window.userData.dimensions||[]).forEach(dim=>(dim.paths||[]).forEach(path=>(path.activities||[]).forEach(act=>(act.completionHistory||[]).forEach(e=>{
                    if (!e.isPenalty && new Date(e.date)>=levelStart) xpThisLevel+=Math.abs(e.xp||0);
                }))));
            }
            if (!xpThisLevel) xpThisLevel = window.userData.currentXP||0;

            const xpRowY  = barTop + barH + 22;
            const prevLvl = newLevel - 1;
            const xpLbl   = `${xpThisLevel.toLocaleString()} XP`;

            // L(prev) — left, greyed
            ctx.font = sf(600, 11); ctx.textAlign = 'left';
            ctx.fillStyle = 'rgba(255,255,255,0.28)';
            ctx.fillText(`L${prevLvl}`, PAD, xpRowY);
            const lLW = ctx.measureText(`L${prevLvl}`).width;

            // L(current) — right, with soft glow pill
            ctx.font = sf(700, 11); ctx.textAlign = 'right';
            const rLbl = `L${newLevel}`;
            const rLW  = ctx.measureText(rLbl).width;
            // glow pill behind L(current)
            ctx.save();
            rr(W-PAD-rLW-10, xpRowY-13, rLW+20, 18, 9);
            ctx.fillStyle=rgba(uProg,0.18); ctx.fill();
            ctx.restore();
            ctx.fillStyle = uProg;
            ctx.fillText(rLbl, W-PAD, xpRowY);

            // Dashed line left of centre
            const xpLblW = (() => { ctx.font=sf(500,11); return ctx.measureText(xpLbl + ' this level').width; })();
            const midX   = W/2;
            const lineY2 = xpRowY - 5;
            const gap    = 8;
            ctx.save();
            ctx.strokeStyle=rgba(uProg,0.35); ctx.lineWidth=0.75;
            ctx.setLineDash([3,3]);
            ctx.beginPath();
            ctx.moveTo(PAD+lLW+5, lineY2);
            ctx.lineTo(midX-xpLblW/2-gap, lineY2);
            ctx.stroke();
            // Dashed line right of centre
            ctx.beginPath();
            ctx.moveTo(midX+xpLblW/2+gap, lineY2);
            ctx.lineTo(W-PAD-rLW-6, lineY2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();

            // XP label centred
            ctx.font = sf(500, 11);
            ctx.fillStyle = 'rgba(200,215,230,0.7)';
            ctx.textAlign = 'center';
            ctx.fillText(xpLbl + ' this level', midX, xpRowY);

            hline(xpRowY + 16, 0.22);

            // ════════════════════════════════════════
            // SECTION 4 — Journey stat cards
            // ════════════════════════════════════════
            let curY = xpRowY + 34;

            // Count activities this level
            let actCount = 0;
            if (levelStart) {
                (window.userData.dimensions||[]).forEach(dim=>(dim.paths||[]).forEach(path=>(path.activities||[]).forEach(act=>(act.completionHistory||[]).forEach(e=>{
                    if (!e.isPenalty && new Date(e.date)>=levelStart) actCount++;
                }))));
            } else {
                (window.userData.dimensions||[]).forEach(dim=>(dim.paths||[]).forEach(path=>(path.activities||[]).forEach(act=>{ actCount+=act.completionCount||0; })));
            }

            // Time string
            const timeStr = (()=>{
                if (!levelStart) return null;
                const d = (Date.now()-levelStart.getTime())/(1000*60*60*24);
                if (d<1){ const h=Math.round(d*24); return h<=1?'under an hour':`${h} hours`; }
                return `${d.toFixed(1)} days`;
            })();

            // Two celebration stat cards side by side
            const cardH = 70;
            const cardW = (W-PAD*2-12)/2;

            function celebCard(x, y, w, h, topLabel, bigVal, subLabel, accentHex) {
                ctx.save(); rr(x,y,w,h,12);
                // gradient background
                const cg = ctx.createLinearGradient(x,y,x+w,y+h);
                cg.addColorStop(0, rgba(accentHex,0.14));
                cg.addColorStop(1, rgba(accentHex,0.05));
                ctx.fillStyle=cg; ctx.fill();
                ctx.strokeStyle=rgba(accentHex,0.32); ctx.lineWidth=0.75; ctx.stroke();
                ctx.restore();
                // top label
                ctx.font=sf(500,10); ctx.fillStyle='rgba(255,255,255,0.4)';
                ctx.textAlign='center'; ctx.fillText(topLabel.toUpperCase(), x+w/2, y+18);
                // big value
                ctx.font=sf(700,bigVal.length>6?18:22); ctx.fillStyle=accentHex;
                ctx.fillText(bigVal, x+w/2, y+44);
                // sub label
                if (subLabel) {
                    ctx.font=sf(400,10); ctx.fillStyle='rgba(255,255,255,0.3)';
                    ctx.fillText(subLabel, x+w/2, y+60);
                }
            }

            if (timeStr || actCount > 0) {
                if (timeStr && actCount > 0) {
                    // Both cards side by side
                    celebCard(PAD,            curY, cardW, cardH, 'Time Taken',     timeStr,        'to reach this level', uProg);
                    celebCard(PAD+cardW+12,   curY, cardW, cardH, 'Activities Done', String(actCount), 'this level',          uAcc);
                } else if (timeStr) {
                    celebCard(PAD, curY, W-PAD*2, cardH, 'Time Taken', timeStr, 'to reach this level', uProg);
                } else {
                    celebCard(PAD, curY, W-PAD*2, cardH, 'Activities Done', String(actCount), 'this level', uAcc);
                }
                curY += cardH + 16;
            }

            // ════════════════════════════════════════
            // SECTION 5 — Top activity card
            // ════════════════════════════════════════
            const topActs = getTopActivitiesThisLevel();
            if (topActs.length > 0) {
                const ta = topActs[0];

                // Section title
                curY += 10; // padding above section
                ctx.font=sf(500,10); ctx.fillStyle='rgba(255,255,255,0.3)';
                ctx.textAlign='left';
                ctx.fillText('TOP ACTIVITY THIS LEVEL', PAD, curY);
                curY += 14;

                const taH = 56;
                ctx.save(); rr(PAD,curY,W-PAD*2,taH,10);
                const tg = ctx.createLinearGradient(PAD,curY,W-PAD,curY+taH);
                tg.addColorStop(0,rgba(uAcc,0.16)); tg.addColorStop(1,rgba(uProg,0.06));
                ctx.fillStyle=tg; ctx.fill();
                ctx.strokeStyle=rgba(uAcc,0.28); ctx.lineWidth=0.75; ctx.stroke();
                ctx.restore();

                ctx.font=sf(600,14); ctx.fillStyle='#fff'; ctx.textAlign='left';
                let tName=ta.name;
                while (ctx.measureText(tName).width>W-PAD*2-110 && tName.length>3) tName=tName.slice(0,-2)+'…';
                ctx.fillText(tName, PAD+12, curY+22);

                if (ta.streak>0) {
                    ctx.font=sf(400,12); ctx.fillStyle=uOlv;
                    ctx.fillText('\uD83D\uDD25 '+ta.streak+'d streak', PAD+12, curY+42);
                }

                ctx.save(); rr(W-PAD-84,curY+10,80,26,8);
                ctx.fillStyle=rgba(uProg,0.2); ctx.fill(); ctx.restore();
                ctx.font=sf(700,12); ctx.fillStyle=uProg; ctx.textAlign='center';
                ctx.fillText('+'+ta.xp.toLocaleString()+' XP', W-PAD-44, curY+28);

                curY += taH + 16;
            }

            // ════════════════════════════════════════
            // SECTION 6 — Most active areas
            // ════════════════════════════════════════
            const levelCatXP = levelStart ? getCategoryXPSince(levelStart) : getCategoryXP();
            const hasLD = Object.values(levelCatXP).some(v=>v>0);
            const top2  = getTop2Categories(hasLD ? levelCatXP : getCategoryXP());

            if (top2.length > 0) {
                curY += 10; // padding above section
                ctx.font=sf(500,10); ctx.fillStyle='rgba(255,255,255,0.3)';
                ctx.textAlign='left';
                ctx.fillText('MOST ACTIVE AREAS', PAD, curY);
                curY += 14;

                const cW2 = (W-PAD*2-12)/2;
                const cH2 = 60;
                top2.forEach((cat,i)=>{
                    const cx=PAD+i*(cW2+12), cy=curY;
                    ctx.save(); rr(cx,cy,cW2,cH2,10);
                    const ctg=ctx.createLinearGradient(cx,cy,cx+cW2,cy+cH2);
                    ctg.addColorStop(0,rgba(cat.color,0.15)); ctg.addColorStop(1,rgba(cat.color,0.05));
                    ctx.fillStyle=ctg; ctx.fill();
                    ctx.strokeStyle=rgba(cat.color,0.32); ctx.lineWidth=0.75; ctx.stroke();
                    ctx.restore();
                    ctx.font='22px serif'; ctx.textAlign='left';
                    ctx.fillText(cat.emoji, cx+10, cy+36);
                    ctx.font=sf(600,14); ctx.fillStyle=cat.color;
                    ctx.fillText(cat.label, cx+42, cy+28);
                    ctx.font=sf(400,11); ctx.fillStyle='rgba(255,255,255,0.38)';
                    ctx.fillText(cat.xp.toLocaleString()+' XP', cx+42, cy+46);
                });
                curY += cH2 + 12;
            }

            // ════════════════════════════════════════
            // FOOTER — vertically centred in remaining space
            // ════════════════════════════════════════
            const footerH = 52;
            const footerY = H - footerH;

            // If there's a lot of gap, push a subtle decorative element
            const gapY = (curY + footerY - footerH) / 2;
            if (footerY - curY > 60) {
                // Decorative dots row
                ctx.save(); ctx.globalAlpha = 0.12;
                for (let di=0; di<5; di++) {
                    const dx = W/2 - 32 + di*16;
                    ctx.beginPath(); ctx.arc(dx, gapY, di===2?3:2, 0, Math.PI*2);
                    ctx.fillStyle = di===2 ? uProg : uAcc;
                    ctx.fill();
                }
                ctx.restore();
            }

            hline(footerY - 6, 0.22);
            ctx.font=sf(600,13); ctx.fillStyle='rgba(255,255,255,0.58)';
            ctx.textAlign='center';
            ctx.fillText('I reached Level '+newLevel+' on Mindkraft!', W/2, footerY+18);
            ctx.font=sf(400,11); ctx.fillStyle='rgba(255,255,255,0.22)';
            ctx.fillText('Gamify your life at mindkraft.life', W/2, footerY+36);

            return new Promise((resolve,reject)=>{
                try {
                    canvas.toBlob(blob=>{
                        if (blob){resolve(blob);return;}
                        canvas.toBlob(blob2=>{
                            if (blob2){resolve(blob2);return;}
                            reject(new Error('Canvas toBlob failed'));
                        },'image/jpeg',0.92);
                    },'image/png');
                } catch(e){reject(e);}
            });
        }
        // ── Share card system ─────────────────────────────────────────────
        // Strategy:
        //   1. On level-up, immediately start pre-building the card in background.
        //   2. On "Share Progress" tap, show a full-screen image overlay first (instant,
        //      no async needed — preserves user gesture for Web Share).
        //   3. From the overlay the user can: long-press to save natively OR tap
        //      the share button which calls navigator.share synchronously on the
        //      already-created object URL (works in PWA standalone on both platforms).
        //   This approach works on Android Chrome PWA, iOS Safari PWA, and desktop.

        window._levelUpCardCache = null;

        window.prebuildLevelUpCard = async function(level) {
            if (!window.userData || !window.currentUser) return;
            try {
                window._levelUpCardCache = null;
                const blob = await buildLevelUpCard(level);
                if (blob) window._levelUpCardCache = { blob, level };
            } catch(e) {
                console.warn('Prebuild failed (non-fatal):', e);
            }
        };

        // Show full-screen image overlay — works universally, no async in tap handler
        function _showCardOverlay(blob, level) {
            // Remove any existing overlay
            const existing = document.getElementById('shareCardOverlay');
            if (existing) existing.remove();

            const objectUrl = URL.createObjectURL(blob);

            const overlay = document.createElement('div');
            overlay.id = 'shareCardOverlay';
            overlay.style.cssText = [
                'position:fixed', 'inset:0', 'z-index:20000',
                'background:rgba(0,0,0,0.92)',
                'display:flex', 'flex-direction:column',
                'align-items:center', 'justify-content:center',
                'padding:16px', 'box-sizing:border-box',
                'overflow-y:auto'
            ].join(';') + ';';

            // Instruction text
            const hint = document.createElement('p');
            hint.style.cssText = 'color:rgba(255,255,255,0.55);font-size:13px;margin:0 0 12px;text-align:center;font-family:inherit;line-height:1.5;';
            hint.textContent = 'Long-press the image to save or share';

            // Card image — fills available width
            const img = document.createElement('img');
            img.src = objectUrl;
            img.style.cssText = [
                'width:100%', 'max-width:360px', 'border-radius:16px',
                'display:block', 'box-shadow:0 16px 48px rgba(0,0,0,0.6)'
            ].join(';') + ';';
            img.alt = 'Level up card';

            // Button row
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;justify-content:center;';

            // Share button — calls navigator.share synchronously on the objectUrl
            const shareBtn = document.createElement('button');
            shareBtn.style.cssText = [
                'padding:12px 24px',
                'background:linear-gradient(135deg,var(--color-accent-blue),var(--color-progress))',
                'color:#fff', 'border:none', 'border-radius:24px',
                'font-size:15px', 'font-weight:600', 'cursor:pointer',
                'font-family:inherit', 'display:inline-flex', 'align-items:center', 'gap:8px'
            ].join(';') + ';';
            shareBtn.innerHTML = '🚀 Share';
            shareBtn.onclick = function() {
                // Synchronous check — no await before the share call
                const isIos = /iP(hone|ad|od)/.test(navigator.userAgent);
                if (navigator.share) {
                    const shareData = { title: 'I reached Level ' + level + ' on Mindkraft!',
                                        text: 'Gamify your life at mindkraft.life 🎮' };
                    // Try with file first, then fall back to text-only — all synchronous setup
                    const fileObj = new File([blob], 'mindkraft-level-' + level + '.png', { type: 'image/png' });
                    let canFile = false;
                    try { canFile = !!(navigator.canShare && navigator.canShare({ files: [fileObj] })); } catch(e) {}
                    const sharePromise = canFile
                        ? navigator.share({ ...shareData, files: [fileObj] })
                        : navigator.share(shareData);
                    sharePromise.then(() => {
                        showToast('Shared! 🎉', 'olive');
                        overlay.remove();
                        URL.revokeObjectURL(objectUrl);
                    }).catch(e => {
                        if (e.name !== 'AbortError') showToast('Share dismissed', 'blue');
                    });
                } else {
                    // Desktop — download
                    const a = document.createElement('a');
                    a.href = objectUrl;
                    a.download = 'mindkraft-level-' + level + '.png';
                    a.click();
                    showToast('Card downloaded! 🎉', 'blue');
                }
            };

            // Save / Download button
            const saveBtn = document.createElement('button');
            saveBtn.style.cssText = [
                'padding:12px 24px',
                'background:rgba(255,255,255,0.08)',
                'color:#fff', 'border:1px solid rgba(255,255,255,0.18)',
                'border-radius:24px', 'font-size:15px', 'font-weight:600',
                'cursor:pointer', 'font-family:inherit'
            ].join(';') + ';';
            saveBtn.textContent = '⬇ Save Image';
            saveBtn.onclick = function() {
                const isIos = /iP(hone|ad|od)/.test(navigator.userAgent);
                if (isIos) {
                    window.open(objectUrl, '_blank');
                    showToast('Image opened — press and hold to save to Photos 📸', 'blue');
                } else {
                    const a = document.createElement('a');
                    a.href = objectUrl;
                    a.download = 'mindkraft-level-' + level + '.png';
                    a.click();
                    showToast('Saved! 🎉', 'blue');
                }
            };

            // Close button
            const closeBtn = document.createElement('button');
            closeBtn.style.cssText = [
                'padding:12px 24px',
                'background:transparent', 'color:rgba(255,255,255,0.4)',
                'border:1px solid rgba(255,255,255,0.12)', 'border-radius:24px',
                'font-size:14px', 'cursor:pointer', 'font-family:inherit'
            ].join(';') + ';';
            closeBtn.textContent = 'Close';
            closeBtn.onclick = function() {
                overlay.remove();
                URL.revokeObjectURL(objectUrl);
            };

            row.appendChild(shareBtn);
            row.appendChild(saveBtn);
            row.appendChild(closeBtn);
            overlay.appendChild(hint);
            overlay.appendChild(img);
            overlay.appendChild(row);
            document.body.appendChild(overlay);
        }

        window.shareLevelUpCard = async function(level) {
            const btn = document.getElementById('shareLevelUpBtn');
            if (btn) { btn.disabled = true; btn.textContent = 'Building card…'; }
            try {
                let blob;
                if (window._levelUpCardCache && window._levelUpCardCache.level === level) {
                    blob = window._levelUpCardCache.blob;
                } else {
                    blob = await buildLevelUpCard(level);
                }
                if (!blob) throw new Error('Card build failed');
                _showCardOverlay(blob, level);
            } catch(e) {
                console.error('Share card error:', e);
                showToast('Could not build card — try again', 'red');
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = '🚀 Share Progress'; }
            }
        };

        // Auth State Listener with timeout fallback
        let authCheckTimeout = setTimeout(() => {
            console.error('Auth initialization timeout - showing login screen');
            document.getElementById('loading').style.display = 'none';
            // Only show auth screen if we haven't already loaded the app
            if (!document.getElementById('appContainer').classList.contains('active')) {
                document.getElementById('authContainer').style.display = 'flex';
                initAuthScreen();
            }
        }, 8000); // 8 second timeout (was 5s — increased for slow connections)

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
                    
                    loadSettings();
                    await processStreakPauses();
                    scheduleReminder();
                    updateDashboard();
                    updateProfileAvatar();
                    // Sync public profile on every login (non-blocking)
                    // This ensures publicProfiles/{uid} is always up-to-date
                    // even if the user hasn't triggered a saveUserData yet.
                    syncPublicProfile().catch(e => {});
                    // Handle deep-link friend add (?add=MK-XXXX in URL)
                    handleFriendDeepLink();
                    // Handle deep-link group join (?joinGroup=CODE in URL)
                    handleGroupDeepLink();
                    // Init the restore backup button visibility (async — non-blocking)
                    updateRestoreBackupBtn().catch(e => {});
                    if (!window.userData.onboardingComplete &&
                        (window.userData.dimensions || []).length === 0 &&
                        (window.userData.totalXP || 0) === 0 &&
                        (window.userData.level || 1) === 1) {
                        showOnboardingOverlay();
                    } else {
                        // Resume incomplete tutorial (persistent until done).
                        // tutorialStep === 99 is the new "done" sentinel; older
                        // values 1–3 from the legacy 4-step flow are also treated
                        // as done since those tab intros are now level-gated.
                        const ts = window.userData.tutorialStep ?? -1;
                        if (ts === 0) {
                            setTimeout(() => showCurrentTutorialStep(), 800);
                        } else {
                            // Tutorial complete — check for pending tab unlocks
                            // (popup + spotlight for tabs whose threshold was
                            // crossed since the last app open).
                            setTimeout(() => checkPendingTabUnlocks(), 800);
                            // Categorization nudge disabled — progressive
                            // notifications will be designed later.
                        }
                    }
                } else {
                    window.currentUser = null;
                    window.userData = null;
                    loading.style.display = 'none';
                    authContainer.style.display = 'flex';
                    initAuthScreen();
                    appContainer.classList.remove('active');
                }
            } catch (error) {
                console.error('Auth state error:', error);
                loading.style.display = 'none';
                if (user) {
                    // User IS authenticated but data load hit a network error.
                    // Show the app with whatever data loadUserData managed to set.
                    if (!window.userData) {
                        window.userData = {
                            level: 1, currentXP: 0, totalXP: 0,
                            dimensions: [], activities: [], challenges: []
                        };
                    }
                    authContainer.style.display = 'none';
                    appContainer.classList.add('active');
                    loadSettings();
                    processStreakPauses().catch(() => {});
                    scheduleReminder();
                    updateDashboard();
                    updateProfileAvatar();
                    showToast('⚠️ Could not reach server — offline mode', 'olive');
                } else {
                    authContainer.style.display = 'flex';
                    initAuthScreen();
                    appContainer.classList.remove('active');
                    showError('Failed to load. Please try again.');
                }
            }
        });

        // Load User Data
        async function loadUserData(uid) {
            const userDocRef = doc(db, 'users', uid);
            let userDoc = null;

            // Try network first, fall back to Firestore local cache on offline errors
            try {
                userDoc = await getDoc(userDocRef);
            } catch (netErr) {
                const isOffline = netErr.code === 'unavailable' ||
                    (netErr.message && (netErr.message.includes('offline') ||
                     netErr.message.includes('network') || netErr.message.includes('fetch')));
                console.warn('Firestore network error (' + (netErr.code || netErr.message) + ') — trying local cache');
                if (isOffline || true) {
                    try {
                        userDoc = await getDocFromCache(userDocRef);
                        console.log('Loaded user data from local Firestore cache');
                        showToast('⚠️ Offline — showing saved data', 'olive');
                    } catch (cacheErr) {
                        // Cache also empty (first install, cleared storage, etc.)
                        console.warn('No local cache available:', cacheErr.message);
                        userDoc = null;
                    }
                }
            }

            if (userDoc && userDoc.exists()) {
                window.userData = userDoc.data();
                // Backfill friendCode for existing users who don't have one yet
                if (!window.userData.friendCode) {
                    window.userData.friendCode = generateFriendCode();
                    setDoc(userDocRef, window.userData).catch(() => {}); // non-blocking, safe offline
                }
                // Hydrate Activities tab preferences (persisted across sessions)
                var _settings = window.userData.settings || {};
                if (_settings.activityViewMode === 'grid' || _settings.activityViewMode === 'list') {
                    window._activityViewMode = _settings.activityViewMode;
                }
                if (_settings.gridCardTypes && typeof _settings.gridCardTypes === 'object') {
                    window._gridCardTypes = _settings.gridCardTypes;
                }
            } else {
                // New user or no cache at all — do NOT write to Firestore yet.
                // The onboarding flow (obQuickStart / obBuildOwn) calls saveUserData()
                // once the user has actually made a choice. Writing a blank doc here
                // risks overwriting a real user's data if Firestore returned a false
                // "not found" due to a network blip or a new-device first login.
                window.userData = {
                    level: 1, currentXP: 0, totalXP: 0,
                    dimensions: [], activities: [], challenges: [],
                    rewards: {}, friends: [],
                    friendCode: generateFriendCode(),
                    createdAt: new Date().toISOString()
                };
            }
            console.log('User data ready');
        }

        // Update Dashboard
        // Recompute bonusXP for all active challenges from current activity baseXP values.
        // Called every dashboard refresh so the displayed (and awarded) bonus stays live
        // without requiring users to manually re-edit the challenge after changing base XP.
        function refreshChallengeBonusXP() {
            const baseXPMap = {};
            (window.userData.dimensions || []).forEach(dim =>
                (dim.paths || []).forEach(path =>
                    (path.activities || []).forEach(act => { baseXPMap[act.id] = act.baseXP || 1; })
                )
            );
            (window.userData.challenges || []).forEach(ch => {
                if (ch.status !== 'active') return;
                const ids = ch.activityIds || (ch.activityId ? [ch.activityId] : []);
                if (!ids.length || !ch.activityTargets) return;
                const totalBaseXP = ids.reduce((s, id) =>
                    s + (baseXPMap[id] || 0) * (ch.activityTargets[id] || 1), 0);
                if (totalBaseXP > 0) ch.bonusXP = Math.max(1, Math.round(totalBaseXP * 0.2));
            });
        }

        function updateDashboard() {
            const data = window.userData;
            refreshChallengeBonusXP(); // keep bonusXP live whenever activity baseXP changes

            // Refresh tab lock styling — runs every render so level-up immediately
            // reflects in the nav (lock icons disappear once threshold is met).
            if (typeof applyTabLockStyling === 'function') applyTabLockStyling();

            // Auto-fail challenges with enforceDateRange whose end date has passed
            const _today = localToday();
            (data.challenges || []).forEach(ch => {
                if (ch.status === 'active' && ch.enforceDateRange && _today > ch.endDate) {
                    ch.status = 'failed';
                }
            });

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
            const todayKey = localToday();
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
                        // Scan backwards — history is chronological, stop when past today.
                        const hist = activity.completionHistory;
                        if (hist) {
                            for (let i = hist.length - 1; i >= 0; i--) {
                                const e = hist[i];
                                if (!e.date) continue;
                                const d = new Date(e.date);
                                if (d.toDateString() !== today) break;
                                if (!e.isPenalty) completedToday++;
                                xpToday += (e.xp || 0);
                            }
                        }
                        // Track longest (all-time best) streak
                        const best = activity.bestStreak || activity.streak || 0;
                        if (best > longestStreak) longestStreak = best;
                    });
                });
            });

            // Add XP from activities deleted today so the stat isn't artificially deflated
            xpToday += (data.xpTodayGhost || {})[todayKey] || 0;

            // Stats trio lives in the Analytics tab DOM. When Analytics hasn't
            // been opened yet, these elements don't exist — guard so missing
            // elements don't throw and abort the rest of updateDashboard.
            var _xpTodayEl    = document.getElementById('xpToday');
            var _doneTodayEl  = document.getElementById('completedToday');
            var _longestEl    = document.getElementById('longestStreak');
            if (_xpTodayEl)   _xpTodayEl.textContent   = xpToday;
            if (_doneTodayEl) _doneTodayEl.textContent = completedToday;
            if (_longestEl)   _longestEl.textContent   = longestStreak;

            const activeTab = window.currentTab || 'activities';
            renderActivitiesList();
            // Re-render dimensions if the Categories sub-tab is visible
            if (activeTab === 'activities') {
                var catPanel = document.getElementById('activitiesSubCategories');
                if (catPanel && catPanel.style.display !== 'none') renderDimensions();
                var planPanel = document.getElementById('activitiesInlinePlanner');
                if (planPanel && planPanel.style.display !== 'none' && typeof renderPlanner === 'function') renderPlanner();
            }
            if (activeTab === 'challenges') renderChallenges();
            if (activeTab === 'analytics') { try { renderDimProgress(); } catch(e) {} }
        }

        // ── Activity Sort & Filter ────────────────────────────────────────
        const SORT_OPTIONS = [
            { id: 'smart',       icon: '⚡', label: "Today's Focus" },
            { id: 'grouped',     icon: '📋', label: 'Grouped by frequency' },
            { id: 'xp-high',     icon: '⬆️', label: 'Highest XP first' },
            { id: 'xp-low',      icon: '⬇️', label: 'Lowest XP first' },
            { id: 'streak-high', icon: '🔥', label: 'Longest streak first' },
        ];

        const DEFAULT_ACTIVITY_SORT = 'grouped';

        let _currentSort = null; // set on render

        function getCurrentSort() {
            return _currentSort || (window.userData.settings?.activitySort) || DEFAULT_ACTIVITY_SORT;
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
                // Position panel below the button using fixed coords
                const rect = btn.getBoundingClientRect();
                panel.style.display = 'block';
                const pW = panel.offsetWidth || 220;
                let left = rect.left;
                // Clamp so panel doesn't bleed off screen edges
                if (left + pW > window.innerWidth - 8) left = window.innerWidth - pW - 8;
                if (left < 8) left = 8;
                panel.style.top = (rect.bottom + 6) + 'px';
                panel.style.left = left + 'px';
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
            if (dot) dot.style.display = (sortId !== DEFAULT_ACTIVITY_SORT) ? 'block' : 'none';
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
                            pathId: path.id,
                            dimColor: dim.color || 'blue'
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
                        <button class="cta-button" onclick="switchSubTab('activities','categories')">🎯 &nbsp;Set up Dimensions</button>
                    </div>
                `;
                return;
            }

            // ── Pre-compute expensive per-activity state ONCE per render ──
            // Eliminates double/triple computation across sort + render phases.
            allActivities.forEach(function(a) {
                var isOcc = a.frequency === 'occasional';
                a._completedToday   = isCompletedToday(a);
                a._canComplete      = canCompleteActivity(a);
                a._countToday       = countCompletionsToday(a);
                a._streak           = isOcc ? 0 : calculateStreak(a);
                a._shieldsUsed      = isOcc ? 0 : getShieldsUsedDisplay(a);
                a._isScheduledDay   = (a.frequency === 'custom' && a.customSubtype === 'days') ? isScheduledDay(a) : true;
                a._cycleCompletions = (a.frequency === 'custom') ? cycleCompletionsNow(a) : 0;
            });

            // Initialise sort from stored preference on first render
            if (!_currentSort) {
                _currentSort = (window.userData.settings?.activitySort) || DEFAULT_ACTIVITY_SORT;
                // If user had a removed sort saved, fall back to default
                if (!SORT_OPTIONS.find(o => o.id === _currentSort)) _currentSort = DEFAULT_ACTIVITY_SORT;
                const dot = document.getElementById('filterActiveDot');
                if (dot) dot.style.display = (_currentSort !== DEFAULT_ACTIVITY_SORT) ? 'block' : 'none';
            }

            // Update activity count in header
            const _slotEl = document.getElementById('activitySlotCount');
            if (_slotEl) {
                const { total: _actT, limit: _actL } = getActivityCounts();
                _slotEl.textContent = _actT + '/' + _actL;
            }

            const sort = getCurrentSort();

            if (!window.activityGroupExpanded) window.activityGroupExpanded = {};

            // ── Frequency sort rank (used by smart sort and grouped) ──
            var FREQ_RANK = { daily: 0, custom: 1, weekly: 2, biweekly: 3, monthly: 4, occasional: 5, 'one-time': 5 };

            // ── Session-completed set: activities completed during this browser session
            //    stay in To Do so user can undo without searching.
            //    Cleared on page reload (it's just a window-level Set).
            if (!window._sessionCompleted) window._sessionCompleted = new Set();

            if (sort === 'smart') {
                // ── Smart "Today's Focus" sort ──────────────────────────────
                var toDo = [];
                var doneTd = [];
                var notNow = [];

                allActivities.forEach(function(a) {
                    var completed = a._completedToday;
                    var canDo = a._canComplete;
                    var isMulti = a.allowMultiplePerDay && a.frequency !== 'occasional';
                    var notScheduled = a.frequency === 'custom' && a.customSubtype === 'days' && !a._isScheduledDay;
                    var doneAnythingToday = a._countToday > 0;

                    if (notScheduled) {
                        notNow.push(a);
                    } else if (isMulti) {
                        toDo.push(a); // multi-complete: always actionable
                    } else if (completed) {
                        // If completed during THIS session, keep in To Do for undo access
                        if (window._sessionCompleted.has(a.id)) {
                            toDo.push(a);
                        } else {
                            doneTd.push(a);
                        }
                    } else if (canDo) {
                        toDo.push(a);
                    } else if (doneAnythingToday) {
                        // Partially completed today but can't do more right now
                        // (e.g. custom cycle 1/3 done, daily limit hit) — keep visible
                        if (window._sessionCompleted.has(a.id)) {
                            toDo.push(a);
                        } else {
                            doneTd.push(a);
                        }
                    } else {
                        notNow.push(a);
                    }
                });

                // Within To Do: sort by pinned first, then by frequency rank, then by XP desc
                toDo.sort(function(a, b) {
                    var pinA = a.pinned ? 0 : 1;
                    var pinB = b.pinned ? 0 : 1;
                    if (pinA !== pinB) return pinA - pinB;
                    var freqA = FREQ_RANK[a.frequency] !== undefined ? FREQ_RANK[a.frequency] : 99;
                    var freqB = FREQ_RANK[b.frequency] !== undefined ? FREQ_RANK[b.frequency] : 99;
                    if (freqA !== freqB) return freqA - freqB;
                    return (b.baseXP || 0) - (a.baseXP || 0);
                });

                doneTd.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
                notNow.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });

                // Default collapsed state for Done and Not Now
                if (window.activityGroupExpanded['smart_done'] === undefined) window.activityGroupExpanded['smart_done'] = false;
                if (window.activityGroupExpanded['smart_notnow'] === undefined) window.activityGroupExpanded['smart_notnow'] = false;

                var smartGroups = [
                    { key: 'smart_todo',   label: '⚡ To Do',    activities: toDo },
                    { key: 'smart_done',   label: '✓ Done',      activities: doneTd },
                    { key: 'smart_notnow', label: '⏸ Not Now',   activities: notNow },
                ].filter(function(g) { return g.activities.length > 0; });

                container.innerHTML = smartGroups.map(function(g) {
                    var isExpanded = (g.key === 'smart_todo')
                        ? window.activityGroupExpanded[g.key] !== false
                        : window.activityGroupExpanded[g.key] === true;
                    return '<div class="act-group" data-group="' + g.key + '">'
                        + '<div class="act-group-header" onclick="toggleActivityGroup(\'' + g.key + '\')">'
                        + '<span class="collapse-icon ' + (isExpanded ? 'expanded' : '') + '">▼</span>'
                        + '<span class="act-group-label">' + g.label + '</span>'
                        + '<span class="act-group-count">' + g.activities.length + '</span>'
                        + '</div>'
                        + '<div class="act-group-body ' + (isExpanded ? 'expanded' : '') + '">'
                        + renderActivityContent(g.activities)
                        + '</div></div>';
                }).join('');

            } else if (sort === 'grouped') {
                // Group by frequency (original view) — reordered
                const groups = [
                    { key: 'daily',      label: 'Daily Activities',      activities: allActivities.filter(a => a.frequency === 'daily') },
                    { key: 'custom',     label: 'Custom Interval',        activities: allActivities.filter(a => a.frequency === 'custom') },
                    { key: 'weekly',     label: 'Weekly Activities',      activities: allActivities.filter(a => a.frequency === 'weekly') },
                    { key: 'biweekly',   label: 'Bi-weekly Activities',   activities: allActivities.filter(a => a.frequency === 'biweekly') },
                    { key: 'monthly',    label: 'Monthly Activities',     activities: allActivities.filter(a => a.frequency === 'monthly') },
                    { key: 'occasional', label: 'Occasional Activities',  activities: allActivities.filter(a => a.frequency === 'occasional' || a.frequency === 'one-time') },
                ].filter(g => g.activities.length > 0);

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
                            ${renderActivityContent(g.activities)}
                        </div>
                    </div>`;
                }).join('');
            } else {
                // Flat sorted list
                let sorted = [...allActivities];
                if (sort === 'xp-high') {
                    sorted.sort((a, b) => (b.baseXP || 0) - (a.baseXP || 0));
                } else if (sort === 'xp-low') {
                    sorted.sort((a, b) => (a.baseXP || 0) - (b.baseXP || 0));
                } else if (sort === 'streak-high') {
                    sorted.sort((a, b) => (b.streak || 0) - (a.streak || 0));
                }
                const sortLabel = SORT_OPTIONS.find(o => o.id === sort)?.label || '';
                container.innerHTML = `
                    <div class="act-group">
                        <div class="act-group-header" style="cursor:default;pointer-events:none;">
                            <span class="act-group-label">${sortLabel}</span>
                            <span class="act-group-count">${sorted.length}</span>
                        </div>
                        <div class="act-group-body expanded">
                            ${renderActivityContent(sorted)}
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
            const today = localToday();
            
            challenges.forEach(challenge => {
                if (challenge.status !== 'active') return;
                
                // Check if challenge is within date range — if expired, just leave it as active
                // (user must manually complete or delete; no auto-fail unless enforceDateRange is set)
                // Only enforce range when both dates are present; empty endDate means no deadline.
                if (challenge.startDate && challenge.endDate &&
                    (today < challenge.startDate || today > challenge.endDate)) return;
                
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
            const today = localToday();
            challenges.forEach(challenge => {
                if (challenge.status !== 'active') return;
                if (challenge.startDate && challenge.endDate &&
                    (today < challenge.startDate || today > challenge.endDate)) return;
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

        // ── Dimension color maps ──────────────────────────────────────────
        var DIM_COLOR_MAP = {
            blue:  'var(--color-accent-blue)',
            red:   'var(--color-accent-red)',
            green: 'var(--color-accent-green)',
            olive: 'var(--color-accent-olive)',
        };

        var DIM_HEX_MAP = {
            blue:  '#4a7c9e',
            red:   '#8e3b5f',
            green: '#6b7c3f',
            olive: '#7a7b4d',
        };

        // _dimRgb: returns "R,G,B" string for use in rgba() — works before hexToRgb (array version) is defined
        function _dimRgb(hex) {
            var r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#4a7c9e');
            return r ? parseInt(r[1],16)+','+parseInt(r[2],16)+','+parseInt(r[3],16) : '74,124,158';
        }

        function renderActivityCards(activities) {
            // Build a set of activity IDs that are part of active challenges
            const challengeActivityIds = new Set();
            (window.userData.challenges || []).forEach(ch => {
                if (ch.status !== 'active') return;
                (ch.activityIds || (ch.activityId ? [ch.activityId] : [])).forEach(id => challengeActivityIds.add(id));
            });

            if (!window._expandedCards) window._expandedCards = {};

            // Ring circumference (r=20, viewBox 48×48) — tighter fit around check circle
            const RING_CIRC = 125.66; // 2π×20

            return activities.map(activity => {
                const completedToday = activity._completedToday;
                const canComplete = activity._canComplete;
                const inChallenge = challengeActivityIds.has(activity.id);
                const allowMulti = activity.allowMultiplePerDay && activity.frequency !== 'occasional';
                const isOccasional = activity.frequency === 'occasional';
                const isSkipMode = !!activity.isSkipNegative;
                const currentStreak = activity._streak;
                const previewStreak = completedToday ? currentStreak : currentStreak + 1;
                const mult = isOccasional ? 1 : calculateConsistencyMultiplier(previewStreak);
                const displayXP = Math.floor(activity.baseXP * mult);
                const showBonus = mult > 1;

                // Dimension color for ring only
                const dimHex = DIM_HEX_MAP[activity.dimColor] || DIM_HEX_MAP.blue;

                // Ring arc progress: streak 0→5 = 0→100%
                const streakProg = Math.min(currentStreak, 5) / 5;
                const ringOffset = (RING_CIRC * (1 - streakProg)).toFixed(2);

                // Shield info
                const shieldsUsed = activity._shieldsUsed;
                const shieldsLeft = Math.max(0, getShieldCap(activity) - shieldsUsed);
                let shieldBadge = '';
                const shieldCritical = currentStreak > 0 && shieldsUsed > 0 && shieldsLeft === 0;
                if (currentStreak > 0 && shieldsUsed > 0) {
                    if (shieldsLeft === 0) {
                        shieldBadge = '<span class="activity-badge badge-shield-warn" title="No shields left — next miss breaks your streak!">🛡 0 left!</span>';
                    } else {
                        shieldBadge = '<span class="activity-badge badge-shield" title="' + shieldsLeft + ' shield' + (shieldsLeft !== 1 ? 's' : '') + ' remaining">' + shieldsLeft + ' 🛡 left</span>';
                    }
                }

                // Counter badge / non-scheduled
                let counterBadge = '';
                let notScheduledToday = false;
                if (activity.frequency === 'custom') {
                    const done = activity._cycleCompletions;
                    const needed = activity.timesPerCycle || 1;
                    if (activity.customSubtype === 'days' && !activity._isScheduledDay) notScheduledToday = true;
                    if (allowMulti) {
                        const todayCount = activity._countToday;
                        counterBadge = `<span class="activity-badge badge-counter">${todayCount > 0 ? `\u00d7${todayCount} today \u00b7 ` : ''}${done}/${needed} cycle</span>`;
                    } else {
                        counterBadge = `<span class="activity-badge badge-counter">${done}/${needed}</span>`;
                    }
                } else if (allowMulti) {
                    const todayCount = activity._countToday;
                    if (todayCount > 0) counterBadge = `<span class="activity-badge badge-counter">\u00d7${todayCount} today</span>`;
                }

                // Click state
                let clickHandler, itemClass;
                if (notScheduledToday)      { clickHandler = 'void(0)'; itemClass = 'disabled'; }
                else if (allowMulti)        { clickHandler = `completeActivityById('${activity.id}')`; itemClass = completedToday ? 'completed-multi' : (isSkipMode ? 'skip-mode-pending' : ''); }
                else if (completedToday)    { clickHandler = 'void(0)'; itemClass = 'completed'; }
                else if (canComplete)       { clickHandler = `completeActivityById('${activity.id}')`; itemClass = isSkipMode ? 'skip-mode-pending' : ''; }
                else                        { clickHandler = 'void(0)'; itemClass = 'disabled'; }

                // Undo button
                const todayCompletionCount = activity._countToday;
                const showUndo = todayCompletionCount > 0 && !notScheduledToday;
                const undoBtn = showUndo
                    ? `<button class="btn-undo-activity" onclick="event.stopPropagation();undoActivityById('${activity.id}')" title="Undo last completion">↩ Undo</button>`
                    : '';

                // Multi counter
                let multiCounterHtml = '';
                if (allowMulti && todayCompletionCount > 0) multiCounterHtml = `<span class="card-multi-count">×${todayCompletionCount}</span>`;

                // XP display in row (OLD position — unchanged)
                let xpText;
                if (isSkipMode && !completedToday) xpText = `+${displayXP}`;
                else xpText = `${activity.isNegative ? '−' : '+'}${displayXP}`;
                const xpColorClass = activity.isNegative ? 'card-xp-negative' : 'card-xp';

                // At-risk / penalty
                const atRisk = !completedToday && !notScheduledToday && activity.streak > 0 && activity.frequency === 'daily' && new Date().getHours() >= 22;
                const todayIso = localToday();
                const showPenaltyTag = activity.isSkipNegative && activity.lastPenaltyDate === todayIso && (activity.lastPenaltyDays || 0) > 0;
                const penaltyDays = activity.lastPenaltyDays || 0;

                // Full XP label for expand area
                let xpBadgeLabel;
                if (isSkipMode) xpBadgeLabel = completedToday ? `+${displayXP} XP earned` : `+${displayXP} XP (skip = −${activity.baseXP})`;
                else xpBadgeLabel = `${activity.isNegative ? '−' : '+'}${displayXP} XP${showBonus ? ` (${mult}×)` : ''}`;

                const isExpanded = !!window._expandedCards[activity.id];
                const hasAlert = atRisk || shieldCritical;
                const isPinned = !!activity.pinned;

                // Detail badges
                const detailBadges = [];
                detailBadges.push(`<span class="activity-badge badge-frequency">${activity.dimensionName} › ${activity.pathName}</span>`);
                detailBadges.push(`<span class="activity-badge ${activity.isNegative ? 'badge-negative' : 'badge-xp'}">${xpBadgeLabel}</span>`);
                if (shieldBadge) detailBadges.push(shieldBadge);
                if (atRisk) detailBadges.push('<span class="activity-badge badge-at-risk">⚠ at risk</span>');
                if (showPenaltyTag) detailBadges.push(`<span class="activity-badge badge-penalty">⚡ −${penaltyDays}d penalty</span>`);
                if (counterBadge) detailBadges.push(counterBadge);
                if (inChallenge) detailBadges.push('<span class="activity-badge" style="background:rgba(122,123,77,0.18);color:var(--color-accent-olive);border:1px solid rgba(122,123,77,0.35);">🏅 Challenge</span>');
                if (isSkipMode && !completedToday) detailBadges.push('<span class="activity-badge badge-penalty" style="opacity:0.7;">⚡ Skip-penalty</span>');

                return `
                <div class="activity-item ${itemClass}" data-aid="${activity.id}" onclick="${clickHandler}"
                     style="--dim-color:${dimHex};">
                    <div class="activity-info-container">
                        <div class="activity-row-main">
                            <button class="act-expand-btn" onclick="event.stopPropagation();toggleCardExpand('${activity.id}')" title="Show details" aria-label="Expand">
                                <svg class="act-expand-chevron ${isExpanded ? 'expanded' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                                ${hasAlert ? '<span class="chevron-alert-dot"></span>' : ''}
                            </button>
                            <div class="activity-name">${escapeHtml(activity.name)}</div>
                            <div class="activity-row-right">
                                <span class="${xpColorClass}">${xpText}</span>
                                ${currentStreak > 0 ? `<span class="card-streak">🔥${currentStreak}</span>` : ''}
                                ${multiCounterHtml}
                                ${atRisk ? '<span class="card-atrisk">⚠</span>' : ''}
                                ${undoBtn}
                            </div>
                        </div>
                        <div class="activity-expand-body ${isExpanded ? 'expanded' : ''}">
                            <div class="activity-details">${detailBadges.join('')}</div>
                        </div>
                    </div>
                    <!-- Progress ring around check placeholder -->
                    <div class="act-ring-wrap">
                        <svg class="act-ring-svg" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                            <circle class="act-ring-bg" cx="24" cy="24" r="20" fill="none" stroke-width="3"/>
                            <circle class="act-ring-done-fill" cx="24" cy="24" r="20" stroke="none"/>
                            <circle class="act-ring-fill" cx="24" cy="24" r="20" fill="none" stroke-width="3"
                                    stroke-dasharray="${RING_CIRC}"
                                    stroke-dashoffset="${ringOffset}"
                                    transform="rotate(-90 24 24)"/>
                        </svg>
                        <div class="act-ring-label">
                            ${completedToday
                                ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
                                : ''
                            }
                        </div>
                    </div>
                </div>
            `}).join('');
        }


        // Toggle card expand/collapse
        window.toggleCardExpand = function(activityId) {
            if (!window._expandedCards) window._expandedCards = {};
            window._expandedCards[activityId] = !window._expandedCards[activityId];
            renderActivitiesList();
        };

        // Toggle pin/favorite on an activity (persisted to userData)
        // ── View mode toggle (list / grid) ────────────────────────────────
        // Initial mode comes from userData on first render; saveUserData persists changes.
        if (!window._activityViewMode) window._activityViewMode = 'list';

        window.toggleActivityView = function() {
            window._activityViewMode = window._activityViewMode === 'list' ? 'grid' : 'list';
            updateViewToggleIcon();
            // Persist preference
            if (window.userData) {
                if (!window.userData.settings) window.userData.settings = {};
                window.userData.settings.activityViewMode = window._activityViewMode;
                if (typeof saveUserData === 'function') saveUserData().catch(function(){});
            }
            renderActivitiesList();
        };

        function updateViewToggleIcon() {
            var btn = document.getElementById('viewToggleBtn');
            if (!btn) return;
            var isGrid = window._activityViewMode === 'grid';
            // Grid icon = 4 squares, List icon = 3 lines
            btn.innerHTML = isGrid
                ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>'
                : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>';
            btn.title = isGrid ? 'Switch to list view' : 'Switch to grid view';
            if (isGrid) btn.classList.add('active'); else btn.classList.remove('active');
        }

        // Dispatcher: renders activities in whichever view mode is active
        function renderActivityContent(activities) {
            if (window._activityViewMode === 'grid') {
                return renderActivityGridCards(activities);
            }
            return renderActivityCards(activities);
        }

        // ── Grid/Card view — state ─────────────────────────────────────────
        if (!window._gridCardTypes) window._gridCardTypes = {};  // activityId → type (1-6)
        if (!window._gridGroups)    window._gridGroups    = {};  // groupId → {name,color,ids}

        // ── Grid long-press → action menu ─────────────────────────────────
        // Short tap completes; long-press (≥450ms) opens an action sheet with
        // "Change size" and "View details". We track state on a module-local
        // object rather than the element so cancellations are airtight.
        var _gcPress = { id: null, timer: null, startX: 0, startY: 0, fired: false };
        var LONG_PRESS_MS = 450;
        var MOVE_CANCEL_PX = 12;

        window._gcPointerDown = function(event, activityId) {
            _gcPress.id      = activityId;
            _gcPress.startX  = event.clientX;
            _gcPress.startY  = event.clientY;
            _gcPress.fired   = false;
            if (_gcPress.timer) clearTimeout(_gcPress.timer);
            _gcPress.timer = setTimeout(function() {
                _gcPress.fired = true;
                if (navigator.vibrate) { try { navigator.vibrate(15); } catch(e) {} }
                openGridActionMenu(activityId);
            }, LONG_PRESS_MS);
        };

        window._gcPointerMove = function(event) {
            if (!_gcPress.timer) return;
            var dx = event.clientX - _gcPress.startX;
            var dy = event.clientY - _gcPress.startY;
            if ((dx*dx + dy*dy) > (MOVE_CANCEL_PX * MOVE_CANCEL_PX)) {
                clearTimeout(_gcPress.timer);
                _gcPress.timer = null;
            }
        };

        window._gcPointerCancel = function(event) {
            if (_gcPress.timer) { clearTimeout(_gcPress.timer); _gcPress.timer = null; }
            _gcPress.id = null;
            _gcPress.fired = false;
        };

        window._gcPointerUp = function(event, activityId) {
            if (_gcPress.timer) { clearTimeout(_gcPress.timer); _gcPress.timer = null; }
            // If long-press already fired, suppress the tap-to-complete.
            if (_gcPress.fired) {
                _gcPress.fired = false;
                _gcPress.id = null;
                return;
            }
            _gcPress.id = null;
            // Find the card and check if it's actually completable in this tap.
            var card = event.currentTarget;
            if (!card || card.dataset.canComplete !== '1') return;
            // Short tap → complete the activity.
            completeActivityById(activityId);
        };

        // ── Grid action menu (long-press result) ──────────────────────────
        var _gcActionActivityId = null;
        window.openGridActionMenu = function(activityId) {
            _gcActionActivityId = activityId;
            // Build/get a singleton menu element so we don't leak DOM.
            var el = document.getElementById('gcActionMenu');
            if (!el) {
                el = document.createElement('div');
                el.id = 'gcActionMenu';
                el.className = 'gc-action-menu';
                el.onclick = function(e) { if (e.target === el) closeGridActionMenu(); };
                document.body.appendChild(el);
            }
            el.innerHTML =
                '<div class="gc-action-menu-inner">'
                + '<button class="gc-action-item" id="gcaSize"><span class="gc-action-icon">⊞</span><span>Change card size</span></button>'
                + '<button class="gc-action-item" id="gcaDetails"><span class="gc-action-icon">⋯</span><span>View details</span></button>'
                + '<button class="gc-action-item gc-action-cancel" id="gcaCancel">Cancel</button>'
                + '</div>';
            el.querySelector('.gc-action-menu-inner').addEventListener('click', function(e) { e.stopPropagation(); });
            document.getElementById('gcaSize').addEventListener('click', function(e) {
                e.stopPropagation();
                closeGridActionMenu();
                setTimeout(function() { openCardTypePicker(activityId); }, 60);
            });
            document.getElementById('gcaDetails').addEventListener('click', function(e) {
                e.stopPropagation();
                closeGridActionMenu();
                setTimeout(function() { openGridCardOverlay(activityId); }, 60);
            });
            document.getElementById('gcaCancel').addEventListener('click', function(e) {
                e.stopPropagation();
                closeGridActionMenu();
            });
            el.style.display = 'flex';
        };

        window.closeGridActionMenu = function() {
            var el = document.getElementById('gcActionMenu');
            if (el) el.style.display = 'none';
            _gcActionActivityId = null;
        };

        window.cycleGridCardType = function(activityId) {
            // Deprecated — now opens the picker popup instead
            openCardTypePicker(activityId);
        };

        // ── Card type picker popup ────────────────────────────────────────
        var _pickerActivityId = null;
        var _pickerOpenedAt   = 0;
        window.openCardTypePicker = function(activityId) {
            _pickerActivityId = activityId;
            _pickerOpenedAt   = Date.now();
            var el = document.getElementById('cardTypePicker');
            var grid = document.getElementById('cardTypePickerGrid');
            if (!el || !grid) return;
            var currentType = window._gridCardTypes[activityId] || 1;

            // Type labels and preview shapes (columns × rows)
            var types = [
                { t:1, label:'1×1', cols:1, rows:1 },
                { t:2, label:'Full',cols:3, rows:2 },
                { t:3, label:'2×1', cols:2, rows:1 },
                { t:4, label:'1×3', cols:1, rows:3 },
                { t:5, label:'1×2', cols:1, rows:2 },
                { t:6, label:'2×2', cols:2, rows:2 },
            ];

            grid.innerHTML = types.map(function(tp) {
                var sel = tp.t === currentType ? ' selected' : '';
                return '<div class="ctp-card' + sel + '" data-type="' + tp.t + '" onclick="selectCardType(' + tp.t + ')">'
                    + '<div class="ctp-line"></div>'
                    + '<div class="ctp-line short"></div>'
                    + (tp.rows > 1 ? '<div class="ctp-line xshort"></div>' : '')
                    + '<div class="ctp-label">' + tp.label + '</div>'
                    + '</div>';
            }).join('');

            el.style.display = 'flex';
        };

        window.selectCardType = function(type) {
            if (_pickerActivityId) {
                window._gridCardTypes[_pickerActivityId] = type;
                // Persist
                if (window.userData) {
                    if (!window.userData.settings) window.userData.settings = {};
                    window.userData.settings.gridCardTypes = window._gridCardTypes;
                    if (typeof saveUserData === 'function') saveUserData().catch(function(){});
                }
                renderActivitiesList();
            }
            closeCardTypePicker();
        };

        window.closeCardTypePicker = function() {
            // Ignore close-clicks that arrived within 250ms of open — they're
            // almost certainly inherited from the long-press gesture that
            // opened us in the first place.
            if (Date.now() - _pickerOpenedAt < 250) return;
            var el = document.getElementById('cardTypePicker');
            if (el) el.style.display = 'none';
            _pickerActivityId = null;
        };

        // Build ring SVG for grid cards — size adapts to card type
        function _gcRing(completedToday, currentStreak, dimHex, xpText, type) {
            // r=18 for large rings, r=14 for type 3 (2×1 compact)
            var isCompact = (type === 3);
            var r = isCompact ? 14 : 18;
            var size = isCompact ? 34 : 44;
            var sw = isCompact ? 2.5 : 3;
            var CIRC = +(2 * Math.PI * r).toFixed(2);
            var prog = Math.min(currentStreak, 5) / 5;
            var offset = (CIRC * (1 - prog)).toFixed(2);
            var cx = size / 2; var cy = size / 2;
            var checkSize = isCompact ? 10 : 14;
            return '<div class="gc-ring-wrap">'
                + '<svg class="gc-ring-svg" viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" xmlns="http://www.w3.org/2000/svg">'
                + '<circle class="gc-ring-bg" cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke-width="' + sw + '"/>'
                + '<circle class="gc-ring-done-fill" cx="' + cx + '" cy="' + cy + '" r="' + r + '" stroke="none"/>'
                + '<circle class="gc-ring-fill" cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke-width="' + sw + '"'
                + ' stroke-dasharray="' + CIRC + '" stroke-dashoffset="' + offset + '"'
                + ' transform="rotate(-90 ' + cx + ' ' + cy + ')"/>'
                + '</svg>'
                + '<div class="gc-ring-label">'
                + (completedToday
                    ? '<svg width="' + checkSize + '" height="' + checkSize + '" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
                    : '<span class="gc-ring-xp">' + xpText + '</span>')
                + '</div></div>';
        }

        function renderActivityGridCards(activities) {
            var challengeActivityIds = new Set();
            (window.userData.challenges || []).forEach(function(ch) {
                if (ch.status !== 'active') return;
                (ch.activityIds || (ch.activityId ? [ch.activityId] : [])).forEach(function(id) { challengeActivityIds.add(id); });
            });

            // Build group lookup
            var actGroupMap = {};
            var groupOrder = [];
            Object.keys(window._gridGroups || {}).forEach(function(gid) {
                var g = window._gridGroups[gid];
                groupOrder.push(gid);
                (g.ids || []).forEach(function(aid) { actGroupMap[aid] = gid; });
            });

            var ungrouped = [];
            var byGroup = {};
            activities.forEach(function(a) {
                var gid = actGroupMap[a.id];
                if (gid) { if (!byGroup[gid]) byGroup[gid] = []; byGroup[gid].push(a); }
                else ungrouped.push(a);
            });

            function renderCard(activity) {
                var type = window._gridCardTypes[activity.id] || 1;
                var completedToday = activity._completedToday;
                var canComplete = activity._canComplete;
                var allowMulti = activity.allowMultiplePerDay && activity.frequency !== 'occasional';
                var isOccasional = activity.frequency === 'occasional';
                var isSkipMode = !!activity.isSkipNegative;
                var currentStreak = activity._streak;
                var previewStreak = completedToday ? currentStreak : currentStreak + 1;
                var mult = isOccasional ? 1 : calculateConsistencyMultiplier(previewStreak);
                var displayXP = Math.floor(activity.baseXP * mult);
                var showBonus = mult > 1;
                var notScheduledToday = activity.frequency === 'custom' && activity.customSubtype === 'days' && !activity._isScheduledDay;
                var todayCount = activity._countToday;
                var shieldsUsed = activity._shieldsUsed;
                var shieldsLeft = Math.max(0, getShieldCap(activity) - shieldsUsed);

                // Click state
                var clickHandler, stateClass;
                if (notScheduledToday)   { clickHandler = 'void(0)'; stateClass = 'gc-disabled'; }
                else if (allowMulti)     { clickHandler = "completeActivityById('" + activity.id + "')"; stateClass = completedToday ? 'gc-done-multi' : ''; }
                else if (completedToday) { clickHandler = 'void(0)'; stateClass = 'gc-done'; }
                else if (canComplete)    { clickHandler = "completeActivityById('" + activity.id + "')"; stateClass = ''; }
                else                    { clickHandler = 'void(0)'; stateClass = 'gc-disabled'; }

                var dimHex = DIM_HEX_MAP[activity.dimColor] || DIM_HEX_MAP.blue;
                var dimRgb = _dimRgb(dimHex);
                var xpText = (activity.isNegative ? '−' : '+') + displayXP;
                var atRisk = !completedToday && !notScheduledToday && activity.streak > 0 && activity.frequency === 'daily' && new Date().getHours() >= 22;
                var inChallenge = challengeActivityIds.has(activity.id);
                var isPinned = !!activity.pinned;
                var todayIso = localToday();
                var showPenaltyTag = activity.isSkipNegative && activity.lastPenaltyDate === todayIso && (activity.lastPenaltyDays || 0) > 0;
                var penaltyDays = activity.lastPenaltyDays || 0;

                // Badge HTML
                var badges = '';
                if (currentStreak > 0 && shieldsUsed > 0) badges += '<span class="gc-badge gc-badge-shield">' + shieldsLeft + ' 🛡</span>';
                if (activity.frequency === 'custom') badges += '<span class="gc-badge gc-badge-counter">' + activity._cycleCompletions + '/' + (activity.timesPerCycle||1) + '</span>';
                if (inChallenge) badges += '<span class="gc-badge gc-badge-challenge">🏅</span>';
                if (atRisk) badges += '<span class="gc-badge gc-badge-alert">⚠</span>';
                if (showPenaltyTag) badges += '<span class="gc-badge gc-badge-skip">⚡' + penaltyDays + 'd</span>';
                if (isSkipMode && !completedToday) badges += '<span class="gc-badge gc-badge-skip">⚡skip</span>';
                if (allowMulti && todayCount > 0) badges += '<span class="gc-badge gc-badge-multi">×' + todayCount + '</span>';

                // XP badge label (full, for type 2)
                var xpBadgeLabel;
                if (isSkipMode) xpBadgeLabel = completedToday ? xpText + ' XP earned' : xpText + ' XP (skip=−' + activity.baseXP + ')';
                else xpBadgeLabel = xpText + ' XP' + (showBonus ? ' (' + mult + '×)' : '');

                // Ring: types 2,3,4,5,6 get ring; only type 1 (compact square) has no ring
                var ringHtml = (type === 1) ? '' : _gcRing(completedToday, currentStreak, dimHex, xpText, type);

                // Undo button (for type 2 shown inline; others via overlay)
                var undoBtnHtml = (todayCount > 0 && !notScheduledToday)
                    ? '<button class="gc-undo" onclick="event.stopPropagation();undoActivityById(\'' + activity.id + '\')">↩ Undo</button>'
                    : '';

                // Type 2 (3×2): full showcase with all details
                var bodyContent;
                if (type === 2) {
                    var fullBadges = '';
                    fullBadges += '<span class="gc-badge gc-badge-counter" style="background:rgba(255,255,255,0.07);color:var(--color-text-secondary);">' + activity.dimensionName + ' › ' + activity.pathName + '</span>';
                    fullBadges += '<span class="gc-badge ' + (activity.isNegative ? 'gc-badge-alert' : 'gc-badge-multi') + '">' + xpBadgeLabel + '</span>';
                    if (currentStreak > 0) fullBadges += '<span class="gc-badge gc-badge-challenge">🔥 ' + currentStreak + ' streak</span>';
                    if (currentStreak > 0 && shieldsUsed > 0) fullBadges += '<span class="gc-badge gc-badge-shield">' + shieldsLeft + ' 🛡 left</span>';
                    if (activity.frequency === 'custom') fullBadges += '<span class="gc-badge gc-badge-counter">' + activity._cycleCompletions + '/' + (activity.timesPerCycle||1) + ' cycle</span>';
                    if (inChallenge) fullBadges += '<span class="gc-badge gc-badge-challenge">🏅 Challenge</span>';
                    if (atRisk) fullBadges += '<span class="gc-badge gc-badge-alert">⚠ at risk</span>';
                    if (showPenaltyTag) fullBadges += '<span class="gc-badge gc-badge-skip">⚡ −' + penaltyDays + 'd penalty</span>';
                    if (isSkipMode && !completedToday) fullBadges += '<span class="gc-badge gc-badge-skip">⚡ skip-penalty</span>';
                    if (allowMulti && todayCount > 0) fullBadges += '<span class="gc-badge gc-badge-multi">×' + todayCount + ' today</span>';
                    bodyContent = '<div class="gc-name">' + escapeHtml(activity.name) + '</div>'
                        + '<div class="gc-badges" style="margin-top:5px;">' + fullBadges + '</div>'
                        + '<div class="gc-footer" style="margin-top:auto;">' + undoBtnHtml + '</div>';
                } else {
                    bodyContent = '<div class="gc-name">' + escapeHtml(activity.name) + '</div>'
                        + '<div class="gc-xp-row">'
                        + '<span class="gc-xp' + (activity.isNegative ? ' gc-xp-neg' : '') + '">' + xpText + ' XP</span>'
                        + (currentStreak > 0 ? '<span class="gc-streak">🔥 ' + currentStreak + '</span>' : '')
                        + '</div>'
                        + (badges && type !== 1 && type !== 4 && type !== 3 ? '<div class="gc-badges">' + badges + '</div>' : '')
                        + '<div class="gc-footer"></div>';
                }

                // Long-press opens the action menu (size/details), short tap completes.
                // We bind raw pointer events on the card root rather than relying on
                // onclick + stopPropagation because that pattern is unreliable on touch.
                var pointerHandlers =
                    ' onpointerdown="_gcPointerDown(event, \'' + activity.id + '\')"'
                  + ' onpointerup="_gcPointerUp(event, \'' + activity.id + '\')"'
                  + ' onpointercancel="_gcPointerCancel(event)"'
                  + ' onpointermove="_gcPointerMove(event)"'
                  + ' oncontextmenu="event.preventDefault()"';

                return '<div class="grid-card ' + stateClass + '" data-aid="' + activity.id + '" data-type="' + type + '"'
                    + ' data-can-complete="' + ((canComplete && !completedToday) || allowMulti ? '1' : '0') + '"'
                    + ' style="--dim-color:' + dimHex + ';--dim-rgba:rgba(' + dimRgb + ',0.18);"'
                    + pointerHandlers + '>'
                    + '<div class="gc-gradient"></div>'
                    + '<div class="gc-body">' + bodyContent + '</div>'
                    + ringHtml
                    + '</div>';
            }

            var html = '<div class="activity-grid">';

            // Render groups
            groupOrder.forEach(function(gid) {
                if (!byGroup[gid] || !byGroup[gid].length) return;
                var g = window._gridGroups[gid];
                html += '<div class="grid-group-section" style="--group-color:' + (g.color||'var(--color-accent-blue)') + '">'
                    + '<span class="grid-group-label">' + escapeHtml(g.name||'Group') + '</span>'
                    + '<div class="grid-group-inner">'
                    + byGroup[gid].map(renderCard).join('')
                    + '</div></div>';
            });

            // Render ungrouped
            html += ungrouped.map(renderCard).join('');

            html += '</div>';
            return html;
        }

        // ── Grid card overlay ─────────────────────────────────────────────
        var _gridOverlayOpenedAt = 0;
        window.openGridCardOverlay = function(activityId) {
            _gridOverlayOpenedAt = Date.now();
            var activity = null;
            var dimHex = DIM_HEX_MAP.blue;
            outer: for (var di = 0; di < (window.userData.dimensions||[]).length; di++) {
                var dim = window.userData.dimensions[di];
                for (var pi = 0; pi < (dim.paths||[]).length; pi++) {
                    for (var ai = 0; ai < (dim.paths[pi].activities||[]).length; ai++) {
                        if (dim.paths[pi].activities[ai].id === activityId) {
                            activity = Object.assign({}, dim.paths[pi].activities[ai], {
                                dimensionName: dim.name, pathName: dim.paths[pi].name,
                                dimColor: dim.color || 'blue'
                            });
                            dimHex = DIM_HEX_MAP[activity.dimColor] || DIM_HEX_MAP.blue;
                            break outer;
                        }
                    }
                }
            }
            if (!activity) return;

            var completedToday = isCompletedToday(activity);
            var canComplete    = canCompleteActivity(activity);
            var streak         = activity.streak || 0;
            var allowMulti     = !!(activity.allowMultiplePerDay && activity.frequency !== 'occasional');
            var isOccasional   = activity.frequency === 'occasional';
            var isSkipMode     = !!activity.isSkipNegative;
            var mult = isOccasional ? 1 : calculateConsistencyMultiplier(completedToday ? streak : streak + 1);
            var displayXP      = Math.floor(activity.baseXP * mult);
            var showBonus      = mult > 1;
            var todayCount     = countCompletionsToday(activity);
            var notScheduled   = activity.frequency === 'custom' && activity.customSubtype === 'days' && !isScheduledDay(activity);
            var shieldsUsed    = activity.shieldsUsedThisCycle || 0;
            var shieldsLeft    = Math.max(0, getShieldCap(activity) - shieldsUsed);
            var inChallenge    = (window.userData.challenges || []).some(function(ch) {
                return ch.status === 'active' && (ch.activityIds || (ch.activityId ? [ch.activityId] : [])).indexOf(activityId) >= 0;
            });
            var todayIso       = localToday();
            var showPenaltyTag = activity.isSkipNegative && activity.lastPenaltyDate === todayIso && (activity.lastPenaltyDays || 0) > 0;
            var penaltyDays    = activity.lastPenaltyDays || 0;
            var atRisk         = !completedToday && !notScheduled && streak > 0 && activity.frequency === 'daily' && new Date().getHours() >= 22;
            var isPinned       = !!activity.pinned;

            var xpText = (activity.isNegative ? '−' : '+') + displayXP;
            var xpBadgeLabel;
            if (isSkipMode) xpBadgeLabel = completedToday ? xpText + ' XP earned' : xpText + ' XP (skip = −' + activity.baseXP + ')';
            else            xpBadgeLabel = xpText + ' XP' + (showBonus ? ' (' + mult + '×)' : '');

            var RING_CIRC  = 131.95;
            var ringOffset = (RING_CIRC * (1 - Math.min(streak, 5) / 5)).toFixed(2);

            // Build all detail badges
            var badgesHtml = '';
            badgesHtml += '<span class="activity-badge badge-frequency">' + escapeHtml(activity.dimensionName) + ' › ' + escapeHtml(activity.pathName) + '</span>';
            badgesHtml += '<span class="activity-badge ' + (activity.isNegative ? 'badge-negative' : 'badge-xp') + '">' + xpBadgeLabel + '</span>';
            if (streak > 0) badgesHtml += '<span class="activity-badge" style="background:rgba(224,160,58,0.12);color:#d4a82a;border:1px solid rgba(224,160,58,0.3);">🔥 ' + streak + ' day streak</span>';
            if (streak > 0 && shieldsUsed > 0) {
                if (shieldsLeft === 0) badgesHtml += '<span class="activity-badge badge-shield-warn">🛡 0 left!</span>';
                else badgesHtml += '<span class="activity-badge badge-shield">' + shieldsLeft + ' 🛡 left</span>';
            }
            if (atRisk) badgesHtml += '<span class="activity-badge badge-at-risk">⚠ at risk</span>';
            if (showPenaltyTag) badgesHtml += '<span class="activity-badge badge-penalty">⚡ −' + penaltyDays + 'd penalty</span>';
            if (activity.frequency === 'custom') badgesHtml += '<span class="activity-badge badge-counter">' + (activity._cycleCompletions||0) + '/' + (activity.timesPerCycle||1) + ' cycle</span>';
            if (allowMulti && todayCount > 0) badgesHtml += '<span class="activity-badge badge-counter">×' + todayCount + ' today</span>';
            if (inChallenge) badgesHtml += '<span class="activity-badge" style="background:rgba(122,123,77,0.18);color:var(--color-accent-olive);border:1px solid rgba(122,123,77,0.35);">🏅 Challenge</span>';
            if (isSkipMode && !completedToday) badgesHtml += '<span class="activity-badge badge-penalty" style="opacity:0.7;">⚡ Skip-penalty</span>';
            badgesHtml += '<span class="activity-badge" style="background:rgba(255,255,255,0.05);color:var(--color-text-secondary);">' + activity.frequency + '</span>';

            var overlay = document.getElementById('gridCardOverlay');
            var content = document.getElementById('gridCardOverlayContent');
            if (!overlay || !content) return;

            content.style.setProperty('--dim-color', dimHex);
            content.innerHTML =
                '<button class="grid-overlay-close" onclick="closeGridCardOverlay()">×</button>'
                // Ring + name row
                + '<div class="grid-overlay-ring-row">'
                + '  <div style="flex-shrink:0;position:relative;width:64px;height:64px;">'
                + '    <svg viewBox="0 0 52 52" width="64" height="64" xmlns="http://www.w3.org/2000/svg">'
                + '      <circle cx="26" cy="26" r="21" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3.5"/>'
                + '      <circle cx="26" cy="26" r="21" fill="' + dimHex + '" fill-opacity="' + (completedToday ? '0.9' : '0') + '" stroke="none"/>'
                + '      <circle cx="26" cy="26" r="21" fill="none" stroke="' + dimHex + '" stroke-width="3.5" stroke-linecap="round"'
                + '              stroke-dasharray="' + RING_CIRC + '" stroke-dashoffset="' + ringOffset + '"'
                + '              transform="rotate(-90 26 26)" style="opacity:' + (completedToday ? '0' : '1') + '"/>'
                + '    </svg>'
                + '    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">'
                + (completedToday
                    ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
                    : '<span style="font-size:12px;font-weight:800;color:' + dimHex + ';line-height:1;">' + xpText + '</span>')
                + '    </div>'
                + '  </div>'
                + '  <div class="grid-overlay-meta">'
                + '    <div style="font-size:16px;font-weight:700;line-height:1.3;color:var(--color-text-primary);">' + escapeHtml(activity.name) + '</div>'
                + '  </div>'
                + '</div>'
                // All detail badges
                + '<div class="grid-overlay-badges">' + badgesHtml + '</div>'
                // Actions
                + '<div class="grid-overlay-actions">'
                + (!notScheduled && canComplete && !completedToday
                    ? '<button class="grid-overlay-btn complete" style="background:' + dimHex + ';" onclick="completeActivityById(\'' + activityId + '\');closeGridCardOverlay();">✓ Complete</button>'
                    : (completedToday ? '<button class="grid-overlay-btn" style="opacity:0.45;cursor:default;">✓ Done today</button>' : ''))
                + (todayCount > 0
                    ? '<button class="grid-overlay-btn undo" onclick="undoActivityById(\'' + activityId + '\');closeGridCardOverlay();">↩ Undo</button>'
                    : '')
                + '</div>';

            overlay.style.display = 'flex';
        };

        window.closeGridCardOverlay = function() {
            if (Date.now() - _gridOverlayOpenedAt < 250) return;
            var el = document.getElementById('gridCardOverlay');
            if (el) el.style.display = 'none';
        };

        // Spawn a floating "+XP" element from a card on completion.
        function spawnFloatingXP(activityId, xpAmount) {
            try {
                var card = document.querySelector('.activity-item[data-aid="' + activityId + '"]')
                        || document.querySelector('.grid-card[data-aid="' + activityId + '"]');
                if (!card) return;
                var rect = card.getBoundingClientRect();
                var el = document.createElement('div');
                el.className = 'act-xp-float';
                el.textContent = (xpAmount >= 0 ? '+' : '−') + Math.abs(xpAmount) + ' XP';
                if (xpAmount < 0) el.style.color = 'var(--color-accent-red)';
                el.style.left = (rect.right - 60) + 'px';
                el.style.top  = (rect.top + rect.height / 2 - 8) + 'px';
                document.body.appendChild(el);
                setTimeout(function() { el.remove(); }, 950);
            } catch (e) { /* non-critical */ }
        }

        // Complete activity by ID (mirrors undoActivityById)
        window.completeActivityById = async function(activityId) {
            const data = window.userData;
            for (let dimIndex = 0; dimIndex < (data.dimensions || []).length; dimIndex++) {
                const dim = data.dimensions[dimIndex];
                for (let pathIndex = 0; pathIndex < (dim.paths || []).length; pathIndex++) {
                    const path = dim.paths[pathIndex];
                    const actIndex = (path.activities || []).findIndex(a => a.id === activityId);
                    if (actIndex !== -1) {
                        var _act = path.activities[actIndex];
                        var _xpPreview = _act.isNegative
                            ? -(_act.negativeXP || _act.baseXP || 0)
                            : (_act.baseXP || 0);
                        spawnFloatingXP(activityId, _xpPreview);
                        await completeActivity(dimIndex, pathIndex, actIndex);
                        return;
                    }
                }
            }
        };

        // Undo activity by ID (for flat activities view)
        window.undoActivityById = async function(activityId) {
            if (window._sessionCompleted) window._sessionCompleted.delete(activityId);
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
            const allDimensions = window.userData.dimensions || [];
            const dimensions = allDimensions.filter(d => d.id !== 'uncategorized');
            const uncDim = allDimensions.find(d => d.id === 'uncategorized');
            const uncActs = uncDim ? (uncDim.paths || []).flatMap(p => p.activities || []) : [];

            if (dimensions.length === 0 && uncActs.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">🎯</div>
                        <p>No dimensions yet. Create your first dimension to get started!</p>
                    </div>
                `;
                return;
            }

            const dimHtml = dimensions.map((dim, i) => {
                const dimIndex = allDimensions.indexOf(dim);
                return `
                <div class="dimension-card">
                    <div class="dimension-header" onclick="toggleDimension(${dimIndex})">
                        <span class="collapse-icon ${dim.expanded ? 'expanded' : ''}">▼</span>
                        <div class="dimension-info">
                            <div class="dimension-name">${escapeHtml(dim.name)}</div>
                            <div class="dimension-meta" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                                <span>${(dim.paths || []).length} paths • ${countDimensionActivities(dim)} activities</span>
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

            // Uncategorized section
            let uncHtml = '';
            if (uncActs.length > 0) {
                const uncDimIndex = allDimensions.indexOf(uncDim);
                const uncPathIndex = uncDim.paths.findIndex(p => p.id === 'uncategorized');
                const actRows = uncActs.map((act, ai) => {
                    const descHtml = act.description
                        ? `<div class="activity-description">${escapeHtml(act.description)}</div>` : '';
                    return `
                    <div class="activity-item" style="cursor:default;">
                        <div class="activity-info-container">
                            <div class="activity-name">${escapeHtml(act.name)}</div>
                            ${descHtml}
                            <div class="activity-details">
                                <span class="activity-badge badge-xp">+${act.baseXP} XP</span>
                            </div>
                        </div>
                        <div class="dimension-actions" onclick="event.stopPropagation()">
                            <button class="btn-icon" onclick="editActivity(${uncDimIndex},${uncPathIndex},${ai})">Edit</button>
                            <button class="btn-icon delete" onclick="deleteActivity(${uncDimIndex},${uncPathIndex},${ai})">Delete</button>
                        </div>
                    </div>`;
                }).join('');
                uncHtml = `
                <div class="dimension-card uncategorized-section" style="margin-top:16px;border-style:dashed;">
                    <div class="dimension-header" style="cursor:default;">
                        <div class="dimension-info">
                            <div class="dimension-name" style="opacity:0.7;">📥 Uncategorized</div>
                            <div class="dimension-meta"><span>${uncActs.length} ${uncActs.length === 1 ? 'activity' : 'activities'} — assign a Dimension &amp; Path to organise</span></div>
                        </div>
                    </div>
                    <div class="dimension-content expanded">
                        ${actRows}
                    </div>
                </div>`;
            }

            container.innerHTML = dimHtml + uncHtml;
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
            // Activity selection is always shown — "any activity" mode removed
            document.getElementById('challengeActivitySelectGroup').style.display = 'block';
        };

        window.openChallengeModal = function(index = null) {
            editingChallengeIndex = index;
            const modal = document.getElementById('challengeModal');
            const title = document.getElementById('challengeModalTitle');
            const submitBtn = document.getElementById('challengeSubmitBtn');

            if (index !== null) {
                const isTakeAgain = !!window._takeAgainMode;
                title.textContent = isTakeAgain ? '🔁 Take Again' : 'Edit Challenge';
                if (submitBtn) submitBtn.textContent = isTakeAgain ? 'Start Again' : 'Save Challenge';
                const challenge = window.userData.challenges[index];
                const selectedIds = challenge.activityIds || (challenge.activityId ? [challenge.activityId] : []);
                const activityTargets = challenge.activityTargets || {};
                populateChallengeActivitySelect(selectedIds, activityTargets);
                document.getElementById('challengeName').value = challenge.name;
                document.getElementById('challengeDescription').value = challenge.description || '';
                document.getElementById('challengeStartDate').value = challenge.startDate;
                document.getElementById('challengeEndDate').value = challenge.endDate;
                onChallengeTypeChange();
                // Restore enforce toggles
                const enforceEl = document.getElementById('challengeEnforceActivities');
                const enforceDateEl = document.getElementById('challengeEnforceDateRange');
                const enforceBtn = document.getElementById('enforceActivitiesBtn');
                const enforceCheck = document.getElementById('enforceActivitiesCheck');
                const enforceDateBtn = document.getElementById('enforceDateRangeBtn');
                const enforceDateCheck = document.getElementById('enforceDateRangeCheck');
                if (enforceEl) enforceEl.checked = !!(challenge.enforceActivities);
                if (enforceBtn) enforceBtn.classList.toggle('active', !!(challenge.enforceActivities));
                if (enforceCheck) enforceCheck.textContent = challenge.enforceActivities ? '✓' : '';
                if (enforceDateEl) enforceDateEl.checked = !!(challenge.enforceDateRange);
                if (enforceDateBtn) enforceDateBtn.classList.toggle('active', !!(challenge.enforceDateRange));
                if (enforceDateCheck) enforceDateCheck.textContent = challenge.enforceDateRange ? '✓' : '';
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
                const _enfd = document.getElementById('challengeEnforceDateRange');
                if (_enfd) _enfd.checked = false;
                document.getElementById('enforceActivitiesBtn')?.classList.remove('active');
                const _ec = document.getElementById('enforceActivitiesCheck');
                if (_ec) _ec.textContent = '';
                document.getElementById('enforceDateRangeBtn')?.classList.remove('active');
                const _edc = document.getElementById('enforceDateRangeCheck');
                if (_edc) _edc.textContent = '';
                document.getElementById('challengeMetricGroup').style.display = 'none';
                onChallengeTypeChange();
                const today = localToday();
                const nextMonth = new Date();
                nextMonth.setMonth(nextMonth.getMonth() + 1);
                document.getElementById('challengeStartDate').value = today;
                document.getElementById('challengeEndDate').value = toLocalDateStr(nextMonth);
            }
            
            modal.classList.add('active');
        };

        window.closeChallengeModal = function() {
            document.getElementById('challengeModal').classList.remove('active');
            editingChallengeIndex = null;
            window._takeAgainMode = false;
        };

        // Stores all activities for the challenge picker (populated lazily on modal open)
        let _challengeAllActivities = [];
        let _challengePickerOpen = false;

        function populateChallengeActivitySelect(selectedIds = [], activityTargets = {}) {
            _challengeAllActivities = [];
            (window.userData.dimensions || []).forEach(dim => {
                (dim.paths || []).forEach(path => {
                    (path.activities || []).forEach(activity => {
                        _challengeAllActivities.push({
                            id: activity.id,
                            name: activity.name,
                            baseXP: activity.baseXP || 0,
                            path: `${dim.name} → ${path.name}`,
                            checked: selectedIds.includes(activity.id),
                            target: activityTargets[activity.id] || 1
                        });
                    });
                });
            });
            // Reset picker to closed state — no DOM rendering yet
            _challengePickerOpen = false;
            const picker = document.getElementById('challengeActivityPicker');
            const toggleBtn = document.getElementById('challengePickerToggle');
            if (picker) picker.style.display = 'none';
            if (toggleBtn) toggleBtn.classList.remove('open');
            const searchEl = document.getElementById('challengeActivitySearch');
            if (searchEl) searchEl.value = '';
            _refreshChallengePickerUI();
            updateChallengeXPPreview();
        }

        function _renderChallengeChecklist(filter = '') {
            const checklist = document.getElementById('challengeActivityChecklist');
            const emptyMsg = document.getElementById('challengeActivityChecklistEmpty');
            if (!checklist) return;
            const q = filter.toLowerCase().trim();
            const visible = _challengeAllActivities.filter(a =>
                !q || a.name.toLowerCase().includes(q) || a.path.toLowerCase().includes(q)
            );
            checklist.innerHTML = '';
            if (visible.length === 0) {
                if (emptyMsg) emptyMsg.style.display = 'block';
                return;
            }
            if (emptyMsg) emptyMsg.style.display = 'none';
            visible.forEach(activity => {
                const item = document.createElement('div');
                item.className = `activity-checklist-item${activity.checked ? ' checked' : ''}`;
                const checkId = `challenge-activity-${activity.id}`;
                const targetInputId = `challenge-target-${activity.id}`;
                item.innerHTML = `
                    <input type="checkbox" id="${checkId}" value="${activity.id}" data-basexp="${activity.baseXP}" ${activity.checked ? 'checked' : ''}>
                    <label for="${checkId}">
                        ${escapeHtml(activity.name)}
                        <span>${escapeHtml(activity.path)} &nbsp;·&nbsp; ${activity.baseXP} XP base</span>
                    </label>
                    <div class="target-input-wrap">
                        <input type="number" id="${targetInputId}" value="${activity.target}" min="1" placeholder="1" onclick="event.stopPropagation()">
                        <label style="cursor:default;">times</label>
                    </div>
                `;
                const checkbox = item.querySelector('input[type="checkbox"]');
                const targetInput = item.querySelector(`#${targetInputId}`);
                checkbox.addEventListener('change', function() {
                    const act = _challengeAllActivities.find(a => a.id === activity.id);
                    if (act) act.checked = this.checked;
                    item.classList.toggle('checked', this.checked);
                    _refreshChallengePickerUI();
                    updateChallengeXPPreview();
                });
                targetInput.addEventListener('input', function() {
                    const act = _challengeAllActivities.find(a => a.id === activity.id);
                    if (act) act.target = Math.max(1, parseInt(this.value) || 1);
                    updateChallengeXPPreview();
                });
                checklist.appendChild(item);
            });
        }

        function _refreshChallengePickerUI() {
            const selected = _challengeAllActivities.filter(a => a.checked);
            const pillsContainer = document.getElementById('challengeSelectedPills');
            const summary = document.getElementById('challengeSelectedSummary');
            const countBadge = document.getElementById('challengePickerToggleCount');
            const toggleLabel = document.getElementById('challengePickerToggleLabel');
            if (pillsContainer) {
                pillsContainer.innerHTML = selected.map(a =>
                    `<span class="ch-pill">${escapeHtml(a.name)}<span class="ch-pill-remove" onclick="uncheckChallengeActivity('${a.id}')">×</span></span>`
                ).join('');
            }
            if (summary) summary.style.display = selected.length > 0 ? 'block' : 'none';
            if (countBadge) {
                countBadge.textContent = `${selected.length} selected`;
                countBadge.style.display = selected.length > 0 ? 'inline-block' : 'none';
            }
            if (toggleLabel) toggleLabel.textContent = selected.length > 0 ? 'Edit Selection' : '＋ Select Activities';
        }

        window.uncheckChallengeActivity = function(id) {
            const act = _challengeAllActivities.find(a => a.id === id);
            if (act) act.checked = false;
            const cb = document.getElementById(`challenge-activity-${id}`);
            if (cb) { cb.checked = false; cb.closest('.activity-checklist-item')?.classList.remove('checked'); }
            _refreshChallengePickerUI();
            updateChallengeXPPreview();
        };

        window.toggleChallengeActivityPicker = function() {
            _challengePickerOpen = !_challengePickerOpen;
            const picker = document.getElementById('challengeActivityPicker');
            const toggleBtn = document.getElementById('challengePickerToggle');
            if (picker) picker.style.display = _challengePickerOpen ? 'block' : 'none';
            if (toggleBtn) toggleBtn.classList.toggle('open', _challengePickerOpen);
            if (_challengePickerOpen) {
                const searchEl = document.getElementById('challengeActivitySearch');
                _renderChallengeChecklist(searchEl ? searchEl.value : '');
                if (searchEl) setTimeout(() => searchEl.focus(), 50);
            }
        };

        window.filterChallengeActivities = function(value) {
            _renderChallengeChecklist(value);
        };

        window.toggleChallengeEnforceActivities = function() {
            const cb = document.getElementById('challengeEnforceActivities');
            const btn = document.getElementById('enforceActivitiesBtn');
            const check = document.getElementById('enforceActivitiesCheck');
            if (!cb) return;
            cb.checked = !cb.checked;
            btn?.classList.toggle('active', cb.checked);
            if (check) check.textContent = cb.checked ? '✓' : '';
        };

        window.toggleChallengeEnforceDateRange = function() {
            const cb = document.getElementById('challengeEnforceDateRange');
            const btn = document.getElementById('enforceDateRangeBtn');
            const check = document.getElementById('enforceDateRangeCheck');
            if (!cb) return;
            cb.checked = !cb.checked;
            btn?.classList.toggle('active', cb.checked);
            if (check) check.textContent = cb.checked ? '✓' : '';
        };

        // Calculate and display auto-XP for specific-activity challenges
        function updateChallengeXPPreview() {
            const preview = document.getElementById('challengeXPPreview');
            const previewVal = document.getElementById('challengeXPPreviewValue');
            if (!preview || !previewVal) return;
            const { totalBaseXP } = calcChallengeAutoXP();
            if (totalBaseXP > 0) {
                const bonus = Math.max(1, Math.round(totalBaseXP * 0.2));
                previewVal.textContent = `+${bonus} XP`;
                preview.style.display = 'flex';
            } else {
                preview.style.display = 'none';
            }
        }

        // Read from master list instead of DOM for accuracy
        function calcChallengeAutoXP() {
            let totalBaseXP = 0;
            _challengeAllActivities.filter(a => a.checked).forEach(a => {
                totalBaseXP += a.baseXP * a.target;
            });
            return { totalBaseXP, bonusXP: Math.max(1, Math.round(totalBaseXP * 0.2)) };
        }

        function getSelectedChallengeActivitiesWithTargets() {
            const result = { activityIds: [], activityTargets: {} };
            _challengeAllActivities.filter(a => a.checked).forEach(a => {
                result.activityIds.push(a.id);
                result.activityTargets[a.id] = a.target;
            });
            return result;
        }

        window.saveChallenge = async function(event) {
            event.preventDefault();
            
            const name = document.getElementById('challengeName').value;
            const description = document.getElementById('challengeDescription').value;
            const startDate = document.getElementById('challengeStartDate').value;
            const endDate = document.getElementById('challengeEndDate').value;

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
            const enforceDateRange = document.getElementById('challengeEnforceDateRange')?.checked || false;

            // Always specific-activity mode
            {
                const selected = getSelectedChallengeActivitiesWithTargets();
                activityIds = selected.activityIds;
                activityTargets = selected.activityTargets;
                if (activityIds.length === 0) { alert('Please select at least one activity.'); return; }
                targetCount = Object.values(activityTargets).reduce((a, b) => a + b, 0);
                bonusXP = calcChallengeAutoXP().bonusXP;
                enforceActivities = document.getElementById('challengeEnforceActivities')?.checked || false;
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
                challenge.enforceDateRange = enforceDateRange;
                if (!challenge.activityProgress) challenge.activityProgress = {};
                // Take Again: wipe all progress and reactivate the challenge
                if (window._takeAgainMode) {
                    challenge.status = 'active';
                    challenge.currentCount = 0;
                    challenge.metricCurrent = 0;
                    activityIds.forEach(id => { challenge.activityProgress[id] = 0; });
                    window._takeAgainMode = false;
                }
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
                    enforceDateRange,
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
            gcSyncProgress().catch(() => {}); // push completed status to group challenge immediately
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

        // Take Again: reset all progress and let the user pick a new date range.
        // The challenge config (activities, targets, name) is preserved; only progress is wiped.
        window.takeAgainChallenge = function(index) {
            const challenge = window.userData.challenges[index];
            if (!challenge || challenge.status !== 'completed') return;
            // Flag so saveChallenge knows to wipe progress after the modal is confirmed
            window._takeAgainMode = true;
            // Pre-clear dates so the modal shows empty date fields ready for new input
            const origStart = challenge.startDate;
            const origEnd   = challenge.endDate;
            challenge.startDate = localToday();
            const nextMonth = new Date();
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            challenge.endDate = toLocalDateStr(nextMonth);
            // Temporarily set status active so openChallengeModal renders the edit form correctly
            challenge.status = 'active';
            openChallengeModal(index);
            // Restore original dates in memory in case user cancels without saving
            challenge.startDate = origStart;
            challenge.endDate   = origEnd;
            challenge.status    = 'completed';
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

            const activeChallenges    = challenges.filter(c => c.status === 'active');
            const completedChallenges = challenges.filter(c => c.status === 'completed');
            const failedChallenges    = challenges.filter(c => c.status === 'failed');

            if (window._completedChallengesExpanded === undefined) window._completedChallengesExpanded = false;
            const completedOpen = window._completedChallengesExpanded;

            let html = '';

            if (activeChallenges.length > 0) {
                html += `<h3 style="margin:24px 0 12px 0;font-size:18px;">Active Challenges</h3>`;
                html += activeChallenges.map(c => renderChallengeCard(c, challenges.indexOf(c))).join('');
            }

            if (completedChallenges.length > 0) {
                html += `
                <div onclick="toggleCompletedChallenges()" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;margin:24px 0 12px 0;user-select:none;padding:4px 0;">
                    <h3 style="font-size:18px;margin:0;display:flex;align-items:center;gap:8px;">
                        Completed
                        <span style="font-size:12px;font-weight:500;color:var(--color-text-secondary);background:rgba(107,124,63,0.15);border-radius:20px;padding:2px 8px;">${completedChallenges.length}</span>
                    </h3>
                    <span style="font-size:12px;color:var(--color-text-secondary);transform:${completedOpen ? 'rotate(180deg)' : 'rotate(0)'};transition:transform 0.2s;display:inline-block;padding:4px;">▼</span>
                </div>
                <div id="completedChallengesSection" style="display:${completedOpen ? 'block' : 'none'};">
                    ${completedChallenges.map(c => renderChallengeCard(c, challenges.indexOf(c))).join('')}
                </div>`;
            }

            if (failedChallenges.length > 0) {
                html += `<h3 style="margin:24px 0 12px 0;font-size:18px;">Failed</h3>`;
                html += failedChallenges.map(c => renderChallengeCard(c, challenges.indexOf(c))).join('');
            }

            container.innerHTML = html;
        }

        window.toggleCompletedChallenges = function() {
            window._completedChallengesExpanded = !window._completedChallengesExpanded;
            renderChallenges();
        };

        window.updateMetricProgress = async function(challengeId) {
            const challenges = window.userData.challenges || [];
            const challenge = challenges.find(c => c.id === challengeId);
            if (!challenge) return;
            const inputEl = document.getElementById('metric-input-' + challengeId);
            if (!inputEl) return;
            const val = parseFloat(inputEl.value);
            if (isNaN(val) || val < 0) { showToast('Enter a valid number', 'red'); return; }
            // Cap at the target — cannot exceed the goal
            const maxVal = challenge.metricQty || Infinity;
            if (val > maxVal) {
                showToast(`Max is ${maxVal} ${challenge.metricUnit || ''} — bar will stop at 100%`, 'red');
                inputEl.value = maxVal;
                challenge.metricCurrent = maxVal;
            } else {
                challenge.metricCurrent = val;
            }
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
            const daysLeft   = Math.ceil((new Date(challenge.endDate + 'T00:00:00') - new Date()) / 86400000);

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
                        <input class="ch-update-input" type="number" id="metric-input-${challenge.id}" placeholder="Current value" step="any" min="0" max="${challenge.metricQty}" value="${metricCurrent > 0 ? metricCurrent : ''}">
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
                                <button class="btn-take-again" onclick="takeAgainChallenge(${index})">🔁 Take Again</button>
                                <button class="btn-icon delete" onclick="deleteChallenge(${index})" title="Delete challenge">✕</button>
                            ` : isFailed ? `
                                <button class="btn-take-again" onclick="takeAgainChallenge(${index})" style="opacity:0.8;">🔁 Retry</button>
                                <button class="btn-icon delete" onclick="deleteChallenge(${index})" title="Delete">✕</button>
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
                        ${activity.description ? `<div class="activity-description">${escapeHtml(activity.description)}</div>` : ''}
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
            } else {
                title.textContent = 'Create Dimension';
                document.getElementById('dimensionForm').reset();
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
            
            if (editingDimensionIndex !== null) {
                window.userData.dimensions[editingDimensionIndex].name = name;
                window.userData.dimensions[editingDimensionIndex].color = color;
            } else {
                window.userData.dimensions.push({
                    id: Date.now().toString(),
                    name,
                    color,
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

        // ── Helper: ensure uncategorized dim+path exist ───────────────
        function getOrCreateUncategorized() {
            if (!window.userData.dimensions) window.userData.dimensions = [];
            const dims = window.userData.dimensions;
            let di = dims.findIndex(d => d.id === 'uncategorized');
            if (di === -1) {
                dims.push({ id: 'uncategorized', name: 'Uncategorized', expanded: true,
                    dimLevel: 1, dimXP: 0, dimTotalXP: 0, dimRewards: {},
                    paths: [], createdAt: new Date().toISOString() });
                di = dims.length - 1;
            }
            if (!dims[di].paths) dims[di].paths = [];
            let pi = dims[di].paths.findIndex(p => p.id === 'uncategorized');
            if (pi === -1) {
                dims[di].paths.push({ id: 'uncategorized', name: 'Uncategorized', expanded: true,
                    activities: [], createdAt: new Date().toISOString() });
                pi = dims[di].paths.length - 1;
            }
            return { di, pi };
        }

        // ── Populate path dropdown (respects uncategorized) ───────────
        window.populateActivityPathSelect = function() {
            const dimId = document.getElementById('activityDimSelect').value;
            const pathSel = document.getElementById('activityPathSelect');
            if (!dimId || dimId === 'uncategorized') {
                pathSel.innerHTML = '<option value="uncategorized">Uncategorized</option>';
                return;
            }
            const dim = (window.userData.dimensions || []).find(d => d.id === dimId);
            const paths = dim ? (dim.paths || []).filter(p => p.id !== 'uncategorized') : [];
            pathSel.innerHTML = paths.length > 0
                ? paths.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')
                : '<option value="">— no paths yet —</option>';
        };

        // ── Unified activity modal (create & edit) ────────────────────
        window.openActivityModal = function(dimIndex, pathIndex, actIndex = null) {
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

            editingActivityDimIndex = dimIndex;
            editingActivityPathIndex = pathIndex;
            editingActivityIndex = actIndex;

            // Populate dimension dropdown (all real dims + Uncategorized)
            const dims = window.userData.dimensions || [];
            const realDims = dims.filter(d => d.id !== 'uncategorized');
            const dimSel = document.getElementById('activityDimSelect');
            dimSel.innerHTML = '<option value="uncategorized">Uncategorized</option>' +
                realDims.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');

            const modal = document.getElementById('activityModal');
            const title = document.getElementById('activityModalTitle');

            if (actIndex !== null) {
                // ── Edit mode ──
                title.textContent = 'Edit Activity';
                const activity = dims[dimIndex].paths[pathIndex].activities[actIndex];
                document.getElementById('activityName').value = activity.name;
                const descEl = document.getElementById('activityDescription');
                if (descEl) descEl.value = activity.description || '';
                document.getElementById('activityXP').value = activity.baseXP;
                document.getElementById('activityFrequency').value = activity.frequency;

                // Set dim/path dropdowns to current assignment
                const curDimId = dims[dimIndex].id;
                dimSel.value = curDimId || 'uncategorized';
                populateActivityPathSelect();
                const curPathId = dims[dimIndex].paths[pathIndex].id;
                document.getElementById('activityPathSelect').value = curPathId || 'uncategorized';

                const isNegEnabled = !!(activity.isNegative || activity.isSkipNegative);
                document.getElementById('activityNegativeEnabled').checked = isNegEnabled;
                document.getElementById('negativeXpSection').style.display = isNegEnabled ? 'block' : 'none';
                const mode = activity.negativeXpMode || (activity.isNegative ? 'perform' : 'skip');
                const modeEl = document.querySelector(`input[name="negativeXpMode"][value="${mode}"]`);
                if (modeEl) modeEl.checked = true;
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

                // Auto-expand Advanced Setup if ANY advanced field is non-default.
                // Definition of "non-default": user-assigned dimension/path (not the
                // 'uncategorized' sentinel), populated description, multiple-per-day,
                // negative XP enabled, or delete-on-complete for occasional.
                const hasAdvanced = (
                    (curDimId && curDimId !== 'uncategorized') ||
                    (curPathId && curPathId !== 'uncategorized') ||
                    !!(activity.description && activity.description.trim()) ||
                    !!activity.allowMultiplePerDay ||
                    isNegEnabled ||
                    !!activity.deleteOnComplete
                );
                setAdvancedSectionOpen(hasAdvanced);
            } else {
                // ── Create mode ──
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
                toggleCustomDays();

                // Pre-select dim/path if provided, else default to uncategorized
                if (dimIndex !== null && pathIndex !== null && dims[dimIndex]) {
                    dimSel.value = dims[dimIndex].id || 'uncategorized';
                } else {
                    dimSel.value = 'uncategorized';
                }
                populateActivityPathSelect();
                if (dimIndex !== null && pathIndex !== null && dims[dimIndex] && dims[dimIndex].paths[pathIndex]) {
                    document.getElementById('activityPathSelect').value = dims[dimIndex].paths[pathIndex].id || 'uncategorized';
                }

                // Create mode: collapse Advanced Setup unless the user is entering
                // via a specific dim/path slot (in which case the dim/path is already
                // a meaningful pre-selection and should be visible).
                const enteredViaSlot = (
                    dimIndex !== null && pathIndex !== null &&
                    dims[dimIndex] && dims[dimIndex].id !== 'uncategorized'
                );
                setAdvancedSectionOpen(enteredViaSlot);
            }

            modal.classList.add('active');
        };

        // ── Advanced Setup section (activity modal) ───────────────────
        // setAdvancedSectionOpen drives both the visible content and the
        // chevron rotation. Called by openActivityModal on every open with
        // a derived initial state (open if any advanced field is non-default).
        function setAdvancedSectionOpen(open) {
            const content = document.getElementById('advancedSectionContent');
            const header  = document.getElementById('advancedSectionHeader');
            if (!content || !header) return;
            content.style.display = open ? 'flex' : 'none';
            header.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        window.toggleAdvancedSection = function() {
            const content = document.getElementById('advancedSectionContent');
            if (!content) return;
            setAdvancedSectionOpen(content.style.display === 'none');
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

            const name = document.getElementById('activityName').value.trim();
            if (!name) return;
            const baseXP = Math.min(50, Math.max(1, parseInt(document.getElementById('activityXP').value) || 1));
            const frequency = document.getElementById('activityFrequency').value;
            const description = (document.getElementById('activityDescription')?.value || '').trim();
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
            const customDays = (frequency === 'custom' && subtype === 'cycle')
                ? Math.max(1, parseInt(document.getElementById('activityCustomDays').value) || 3) : null;
            const scheduledDays = (frequency === 'custom' && subtype === 'days') ? getSelectedDays() : null;
            const timesPerCycle = frequency === 'custom'
                ? Math.max(1, parseInt(document.getElementById('activityCustomTimes').value) || 1) : null;
            const deleteOnComplete = frequency === 'occasional'
                ? document.getElementById('activityDeleteOnComplete').checked : false;

            // Resolve target dim/path from dropdowns
            const selectedDimId  = document.getElementById('activityDimSelect').value;
            const selectedPathId = document.getElementById('activityPathSelect').value;
            let targetDi, targetPi;
            if (!selectedDimId || selectedDimId === 'uncategorized') {
                const unc = getOrCreateUncategorized();
                targetDi = unc.di; targetPi = unc.pi;
            } else {
                const dims = window.userData.dimensions || [];
                const di = dims.findIndex(d => d.id === selectedDimId);
                if (di === -1) { const unc = getOrCreateUncategorized(); targetDi = unc.di; targetPi = unc.pi; }
                else {
                    targetDi = di;
                    const pi = dims[di].paths.findIndex(p => p.id === selectedPathId);
                    if (pi === -1) { const unc = getOrCreateUncategorized(); targetDi = unc.di; targetPi = unc.pi; }
                    else targetPi = pi;
                }
            }

            const actFields = { name, baseXP, frequency, description, isNegative, isSkipNegative,
                negativeXpMode, allowMultiplePerDay, customSubtype: subtype, customDays,
                scheduledDays, timesPerCycle, deleteOnComplete };

            const isNewActivity = editingActivityIndex === null;

            if (!isNewActivity) {
                // ── Edit existing ──
                const origDi = editingActivityDimIndex;
                const origPi = editingActivityPathIndex;
                const origAi = editingActivityIndex;
                const activity = window.userData.dimensions[origDi].paths[origPi].activities[origAi];
                Object.assign(activity, actFields);
                // Move if dim/path changed
                if (targetDi !== origDi || targetPi !== origPi) {
                    window.userData.dimensions[origDi].paths[origPi].activities.splice(origAi, 1);
                    if (!window.userData.dimensions[targetDi].paths[targetPi].activities)
                        window.userData.dimensions[targetDi].paths[targetPi].activities = [];
                    window.userData.dimensions[targetDi].paths[targetPi].activities.push(activity);
                }
            } else {
                // ── Create new ──
                if (!canAddActivity()) { alert('You\'ve reached your activity limit! Level up to unlock more.'); return; }
                const targetPath = window.userData.dimensions[targetDi].paths[targetPi];
                if (!targetPath.activities) targetPath.activities = [];
                targetPath.activities.push({
                    id: Date.now().toString(), ...actFields,
                    streak: 0, skipStreak: 0, lastCompleted: null, cycleCompletions: 0,
                    totalXP: 0, completionCount: 0, isFavorite: false,
                    completionHistory: [], cycleHistory: [], streakShields: 0,
                    createdAt: new Date().toISOString()
                });
                // Advance tutorial: first activity ever created marks the
                // create-first-activity step done. Subsequent tab intros are
                // level-gated and fire as unlock spotlights, not as part of
                // this sequence anymore.
                if ((window.userData.tutorialStep ?? -1) === 0) {
                    window.userData.tutorialStep = 99;
                }
            }

            await saveUserData();
            closeActivityModal();
            updateDashboard();

            // If we just completed the first-activity step, dismiss the
            // tutorial overlay (it was likely visible behind the modal).
            if (isNewActivity && window.userData.tutorialStep === 99) {
                hideTutorialOverlay();
            }
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
                const _todayKey  = localToday();
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

                _logDeletedActivity(activity);
                window.userData.dimensions[dimIndex].paths[pathIndex].activities.splice(actIndex, 1);
                // Clean up references in challenges
                if (actId) cleanupChallengesForActivity(actId);
                await saveUserData();
                updateDashboard();
            }
        };

        // Log a deleted activity so its history stays visible in Activity History
        function _logDeletedActivity(activity) {
            if (!activity || !(activity.completionHistory || []).length) return;
            if (!window.userData.deletedActivityLog) window.userData.deletedActivityLog = [];
            if (window.userData.deletedActivityLog.some(function(e){ return e.id === activity.id; })) return;
            var dimName = '', pathName = '';
            (window.userData.dimensions || []).forEach(function(d) {
                (d.paths || []).forEach(function(p) {
                    if ((p.activities || []).some(function(a){ return a.id === activity.id; })) {
                        dimName = d.name; pathName = p.name;
                    }
                });
            });
            window.userData.deletedActivityLog.push({
                id: activity.id, name: activity.name,
                dimName: dimName, pathName: pathName,
                deletedAt: new Date().toISOString(),
                completionHistory: (activity.completionHistory || []).slice(-365),
            });
            if (window.userData.deletedActivityLog.length > 200)
                window.userData.deletedActivityLog.shift();
        }

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
            const history = activity.completionHistory;
            if (!history || history.length === 0) return 0;
            const todayStr = new Date().toDateString();
            // History is chronological (newest last) — scan backwards and
            // stop as soon as we pass today. Turns O(365) into O(today's entries).
            let count = 0;
            for (let i = history.length - 1; i >= 0; i--) {
                const e = history[i];
                const d = new Date(e.date);
                if (d.toDateString() !== todayStr) break;
                if (!e.isPenalty) count++;
            }
            return count;
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

        // ══════════════════════════════════════════════════════════════════
        // ── Streak & Shield System ────────────────────────────────────────
        // ══════════════════════════════════════════════════════════════════
        //
        // STORED FIELDS (authoritative):
        //   activity.streak            — current streak count.
        //   activity.bestStreak        — all-time high. Never decremented.
        //   activity.shieldsConsumed   — shields used this streak (0–3).
        //   activity.streakGrantedDate — LOCAL date, prevents double-grant same day.
        //   activity.lastProcessedDate — LOCAL date, idempotency stamp for login walk.
        //   activity.skipPenaltyWindow — LOCAL date, anchor for XP penalty tracking.
        //
        // OWNERSHIP (strict — nothing else writes these):
        //   processStreakSystem()  — streak, shieldsConsumed, bestStreak, lastProcessedDate
        //   completeActivity()     — streak (+1 today via streakGrantedDate guard)
        //   undoActivity()         — streak (−1 if granted today)
        //   processSkipPenalty()   — skipPenaltyWindow
        //
        // RENDER FUNCTIONS (read-only — zero computation, zero history walk):
        //   calculateStreak()      — returns activity.streak
        //   getShieldsUsedDisplay()— returns activity.shieldsConsumed
        //
        // SHIELD RULES:
        //   3 shields per streak. Each missed closed window costs 1 shield.
        //   Streak survives ≤3 total misses. 4th unshielded miss → streak=0.
        //   Shields reset automatically on a new streak.
        // ══════════════════════════════════════════════════════════════════

        const BASE_SHIELDS      = 3;
        const SHIELD_MILESTONES = [25, 50, 75, 100];
        const SHIELD_ABS_CAP    = 7; // 3 base + 4 milestone bonuses

        function getShieldCap(activity) {
            return activity.shieldCapUsed || BASE_SHIELDS;
        }

        // ── _missedWindowsSince ───────────────────────────────────────────
        // PRIVATE. Counts closed windows strictly AFTER fromDateStr (local YYYY-MM-DD)
        // up to (not including) today's open window.
        // Returns { count, lastWindowDateStr } so callers can advance their stamp.
        // cap parameter: max misses to count before returning early (default: no cap).
        // Shield callers pass cap+1; penalty callers pass 7.
        function _missedWindowsSince(activity, fromDateStr, cap) {
            cap = cap || 999;
            const todayMidnight = new Date(); todayMidnight.setHours(0,0,0,0);
            const todayCycleStart = getCycleWindowStart(activity, todayMidnight);
            if (!todayCycleStart) return { count: 0, lastWindowDateStr: fromDateStr };

            const fromWin = getCycleWindowStart(activity, new Date(fromDateStr + 'T00:00:00'));
            if (!fromWin) return { count: 0, lastWindowDateStr: fromDateStr };

            let cursor = getNextCycleWindowStart(activity, fromWin);
            if (!cursor || cursor.getTime() >= todayCycleStart.getTime()) {
                return { count: 0, lastWindowDateStr: fromDateStr };
            }

            const history = (activity.completionHistory || []).filter(
                e => !e.isPenalty && (e.xp || 0) > 0
            );

            let count = 0;
            let lastWindowDateStr = fromDateStr;

            while (cursor.getTime() < todayCycleStart.getTime()) {
                const next = getNextCycleWindowStart(activity, cursor);
                if (!next) break;
                const hit = history.some(e => {
                    const t = new Date(e.date).getTime();
                    return t >= cursor.getTime() && t < next.getTime();
                });
                lastWindowDateStr = toLocalDateStr(cursor);
                if (!hit) count++;
                if (count >= cap) return { count, lastWindowDateStr };
                cursor = next;
            }
            return { count, lastWindowDateStr };
        }

        // _getStreakShieldWindow removed. Shield computation is now fully owned
        // by processStreakSystem (login-time, authoritative walk). See below.

        // ── _getSkipPenaltyWindow ─────────────────────────────────────────
        // Returns the current skipPenaltyWindow, or derives a safe starting anchor.
        // Migration priority:
        //   1. skipPenaltyWindow — set by v32+, most accurate.
        //   2. lastSkipCheckDate — old system's "ran up to this day" stamp.
        //      Using the window containing this date means we start AFTER all
        //      windows the old system already penalised. Prevents double-charging.
        //   3. lastCompleted window — safe fallback for brand-new activities.
        function _getSkipPenaltyWindow(activity) {
            if (activity.skipPenaltyWindow) return activity.skipPenaltyWindow;
            // Old system stamped lastSkipCheckDate = the calendar day it ran.
            // That day's window was already processed — use it as the anchor so
            // we only count windows AFTER it.
            if (activity.lastSkipCheckDate) {
                const w = getCycleWindowStart(activity,
                    new Date(activity.lastSkipCheckDate + 'T00:00:00'));
                return w ? toLocalDateStr(w) : null;
            }
            if (activity.lastCompleted) {
                const w = getCycleWindowStart(activity, new Date(activity.lastCompleted));
                return w ? toLocalDateStr(w) : null;
            }
            return null;
        }

        // ── calculateStreak ──────────────────────────────────────────────
        // READ-ONLY render helper. Returns the stored streak field.
        // processStreakSystem (login-time) is the sole writer for shielded
        // activity types. Perform-negative activities have no shields, so
        // we compute their expiry on-the-fly here (no login processing needed).
        function calculateStreak(activity) {
            if (!activity.lastCompleted) return 0;
            if (activity.frequency === 'occasional') return 0;

            // Perform-negative: no shields, expires on grace-day breach
            if (activity.isNegative && !activity.isSkipNegative) {
                const lastMidnight = new Date(activity.lastCompleted); lastMidnight.setHours(0,0,0,0);
                const todayMidnight = new Date(); todayMidnight.setHours(0,0,0,0);
                const daysDiff = Math.round((todayMidnight - lastMidnight) / (1000 * 60 * 60 * 24));
                return daysDiff <= getStreakGraceDays(activity) ? (activity.streak || 0) : 0;
            }

            // All other types: trust the stored value written by processStreakSystem.
            return activity.streak || 0;
        }

        // ── getShieldsUsedDisplay ─────────────────────────────────────────
        // READ-ONLY render helper. Returns the stored shieldsConsumed field.
        // processStreakSystem (login-time) is the sole writer.
        function getShieldsUsedDisplay(activity) {
            if (activity.frequency === 'occasional') return 0;
            if (activity.isNegative && !activity.isSkipNegative) return 0;
            if (!activity.lastCompleted || (activity.streak || 0) === 0) return 0;
            return activity.shieldsConsumed || 0;
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

            // processStreakSystem (login-time) owns streak and shieldsConsumed.
            // completeActivity only grants today's streak +1 via streakGrantedDate guard.
            // Use LOCAL date string to avoid UTC-midnight mismatch for UTC+ users.
            const currentStreak = isOccasional ? 0 : (activity.streak || 0);
            const todayStr = toLocalDateStr(new Date());
            const cycleWasEmpty = isCustom ? (cycleCompletionsNow(activity) === 0) : false;
            const alreadyGrantedToday = (!isCustom && activity.streakGrantedDate === todayStr);
            const shouldGrantStreak = !isOccasional && (isCustom ? cycleWasEmpty : !alreadyGrantedToday);
            const newStreak = isOccasional ? 0 : (shouldGrantStreak ? currentStreak + 1 : currentStreak);
            if (!isOccasional && shouldGrantStreak) {
                activity.streakGrantedDate = todayStr;
                // Stamp the start of a new streak so processStreakSystem's walk
                // cannot bridge across the previous break gap using shields.
                if (currentStreak === 0) {
                    activity.streakStartWindow = todayStr;
                }
            }

            const consistencyMultiplier = isOccasional ? 1 : calculateConsistencyMultiplier(newStreak);
            const earnedXP = Math.floor(activity.baseXP * consistencyMultiplier);
            
            activity.lastCompleted = new Date().toISOString();
            // Advance skipPenaltyWindow to current window so processSkipPenalty
            // counts forward from here — never re-counting past windows.
            // (streakShieldWindow removed: processStreakSystem walks history directly.)
            if (!isOccasional) {
                const _thisWin = getCycleWindowStart(activity, new Date());
                if (_thisWin) {
                    activity.skipPenaltyWindow = toLocalDateStr(_thisWin);
                }
            }
            // Track cycle completions for custom activities
            if (isCustom) {
                if (!activity.cycleHistory) activity.cycleHistory = [];
                activity.cycleHistory.push({ date: activity.lastCompleted });
                activity.cycleCompletions = cycleCompletionsNow(activity);
            }
            if (!isOccasional) {
                activity.streak = newStreak;
                activity.bestStreak = Math.max(activity.bestStreak || 0, newStreak);
                if (shouldGrantStreak) {
                    checkStreakMilestone(activity.name, newStreak);
                    // Milestone shield bonus: +1 when streak crosses 25/50/75/100.
                    // This updates shieldCapUsed in real-time so the render is
                    // immediately correct. processStreakSystem re-derives the same
                    // value from history on next login, so they stay in sync.
                    if (SHIELD_MILESTONES.includes(newStreak)) {
                        activity.shieldCapUsed = Math.min(SHIELD_ABS_CAP,
                            (activity.shieldCapUsed || BASE_SHIELDS) + 1);
                    }
                }
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
                    // Store the window of the level just completed for the share card.
                    // Use the previous levelStartedAt (or a sentinel 5min ago if first level-up)
                    // so the card captures ALL completions including the one that triggered this.
                    window.userData.cardLevelStartedAt = window.userData.levelStartedAt
                        || new Date(Date.now() - 5*60*1000).toISOString();
                    window.userData.levelStartedAt = new Date().toISOString();
                    // Pre-build share card in background immediately — must happen before
                    // user taps Share to keep within Android's user-gesture window
                    const _levelForCard = window.userData.level;
                    setTimeout(() => { prebuildLevelUpCard(_levelForCard).catch(() => {}); }, 0);
                    // deleteOnComplete must fire even when a level-up occurs — the early
                    // return below would otherwise skip the deletion block further down.
                    if (isOccasional && activity.deleteOnComplete) {
                        _logDeletedActivity(activity);
                        const _dims = window.userData.dimensions;
                        _outerLU: for (let _di = 0; _di < _dims.length; _di++) {
                            for (let _pi = 0; _pi < _dims[_di].paths.length; _pi++) {
                                const _acts = _dims[_di].paths[_pi].activities || [];
                                const _ai = _acts.findIndex(a => a.id === activity.id);
                                if (_ai !== -1) { _acts.splice(_ai, 1); break _outerLU; }
                            }
                        }
                    }
                    showLevelUpAnimation();
                    updateDashboard();
                    showXPToast(xpChange, newStreak, consistencyMultiplier);
                    debouncedSaveUserData(); // fire-and-forget — UI already updated
                    return;
                }
            }

            // For deleteOnComplete: splice before updateDashboard so the card
            // disappears in the same render pass. Log to deletedActivityLog first
            // so history remains visible.
            if (isOccasional && activity.deleteOnComplete) {
                _logDeletedActivity(activity);
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
            debouncedSaveUserData(); // single write covers XP + optional deletion
            // Only sync group progress when the activity is part of an active challenge —
            // avoids unnecessary Firestore writes and prevents the momentum bar from ticking
            // up when the user completes activities unrelated to their nominated challenges.
            if (window.userData.activeGroupChallengeId) {
                const actId = activity.id;
                const isInActiveChallenge = (window.userData.challenges || []).some(ch =>
                    ch.status === 'active' &&
                    ((ch.activityIds || []).includes(actId) || ch.activityId === actId)
                );
                if (isInActiveChallenge) gcSyncProgress().catch(() => {});
            }
        };

        // Undo Activity Completion
        window.undoActivity = async function(dimIndex, pathIndex, actIndex) {
            const activity = window.userData.dimensions[dimIndex].paths[pathIndex].activities[actIndex];
            
            // Must have at least one non-penalty completion today to undo.
            // Use LOCAL date to match streakGrantedDate (which is also local).
            const todayStr = toLocalDateStr(new Date());
            const todayUserEntries = (activity.completionHistory || []).filter(
                e => !e.isPenalty && toLocalDateStr(new Date(e.date)) === todayStr
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
                // Rewind skipPenaltyWindow to the previous completion's window so
                // processSkipPenalty doesn't re-charge for already-penalised days.
                // shieldsConsumed is NOT rewound — processStreakSystem recomputes it
                // from history at next login.
                const _prevWin = getCycleWindowStart(activity, new Date(prevUserEntry.date));
                if (_prevWin) {
                    activity.skipPenaltyWindow = toLocalDateStr(_prevWin);
                }
            } else {
                activity.lastCompleted = null;
                activity.skipPenaltyWindow  = null;
            }

            // Revert streak grant: if no completions remain today, undo today's increment.
            // shieldsConsumed is intentionally NOT touched — shields are owned by
            // processStreakSystem and reflect past missed windows, not today's action.
            const stillHasToday = remainingUserHistory.some(
                e => toLocalDateStr(new Date(e.date)) === todayStr
            );
            if (!isOccasional && !stillHasToday && activity.streakGrantedDate === todayStr && activity.streak > 0) {
                activity.streak = Math.max(0, activity.streak - 1);
                activity.streakGrantedDate = null;
                if (activity.streak === 0) activity.streakStartWindow = null;
            }
            if (!isOccasional && activity.frequency === 'custom' && activity.cycleCompletions === 0 && activity.streakGrantedDate) {
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
            debouncedSaveUserData(); // fire-and-forget
        };

        // ── Retroactive Write Functions (Phase 2) ────────────────────────

        async function applyRetroactiveRecalculation(activity, dimIndex, xpDelta) {
            // 1. Per-activity counters
            recomputeActivityCounters(activity);

            // 2. Streak from history (idempotency-free)
            recomputeStreakFromHistory(activity);

            // 3. Challenge progress
            recomputeChallengeProgress(activity.id);

            // 4. Dimension XP
            const dim = (window.userData.dimensions || [])[dimIndex];
            if (dim) recomputeDimXP(dim);

            // 5. Apply XP delta — same pattern as completeActivity / undoActivity.
            //    xpDelta is +baseXP for a retroactive add, -entry.xp for a delete
            //    (penalty entries store negative xp so -entry.xp restores the deduction).
            //    No full history scan needed — we already know exactly what changed.
            window.userData.totalXP = Math.max(0, (window.userData.totalXP || 0) + xpDelta);
            const { level, currentXP } = recomputeLevelFromTotalXP(window.userData.totalXP);
            window.userData.level = level;
            window.userData.currentXP = currentXP;

            // 6. Persist and re-render
            await saveUserData();
            updateDashboard();
        }

        window.retroactiveComplete = async function(activityId, dateStr) {
            const todayStr = localToday();
            const sevenDaysAgo = toLocalDateStr(new Date(Date.now() - 7 * 86400000));

            if (dateStr >= todayStr) {
                showToast('Use the activity card to mark today\'s completion.', 'red'); return;
            }
            if (dateStr < sevenDaysAgo) {
                showToast('Retroactive edits are limited to the last 7 days.', 'red'); return;
            }

            let foundActivity = null, foundDi = -1, foundPi = -1;
            const dims = window.userData.dimensions || [];
            outer: for (let di = 0; di < dims.length; di++) {
                for (let pi = 0; pi < (dims[di].paths || []).length; pi++) {
                    const ai = (dims[di].paths[pi].activities || []).findIndex(a => a.id === activityId);
                    if (ai !== -1) {
                        foundActivity = dims[di].paths[pi].activities[ai];
                        foundDi = di; foundPi = pi;
                        break outer;
                    }
                }
            }
            if (!foundActivity) { showToast('Activity not found.', 'red'); return; }
            if (foundActivity.frequency === 'occasional') { showToast('Occasional activities cannot be retroactively logged.', 'red'); return; }

            const alreadyDone = (foundActivity.completionHistory || []).some(e =>
                !e.isPenalty && toLocalDateStr(new Date(e.date)) === dateStr
            );
            if (alreadyDone && !foundActivity.allowMultiplePerDay) {
                showToast('Already marked for that day.', 'red'); return;
            }

            const entryDate = new Date(dateStr + 'T12:00:00');
            const xp = foundActivity.baseXP;
            if (!foundActivity.completionHistory) foundActivity.completionHistory = [];
            foundActivity.completionHistory.push({ date: entryDate.toISOString(), xp });
            foundActivity.completionHistory.sort((a, b) => new Date(a.date) - new Date(b.date));
            if (foundActivity.completionHistory.length > 365) foundActivity.completionHistory.shift();

            await applyRetroactiveRecalculation(foundActivity, foundDi, xp);
            if (typeof renderHistoryEdit === 'function') renderHistoryEdit();
            renderActivityHistory(true);
            showToast(`✓ Logged ${foundActivity.name} for ${dateStr} (+${xp} XP)`, 'blue');
        };

        window.retroactiveDelete = async function(activityId, entryTimestamp) {
            const todayStr = localToday();
            const sevenDaysAgo = toLocalDateStr(new Date(Date.now() - 7 * 86400000));
            const entryDateStr = toLocalDateStr(new Date(entryTimestamp));

            if (entryDateStr >= todayStr) {
                // Allow deleting today's penalties (no undo button exists for them).
                // Block only non-penalty completions — those use the undo button.
                const peekEntry = (() => {
                    let found = null;
                    outer2: for (let di = 0; di < (window.userData.dimensions || []).length; di++) {
                        for (let pi = 0; pi < ((window.userData.dimensions[di].paths) || []).length; pi++) {
                            const act = ((window.userData.dimensions[di].paths[pi].activities) || []).find(a => a.id === activityId);
                            if (act) { found = (act.completionHistory || []).find(e => e.date === entryTimestamp); break outer2; }
                        }
                    }
                    return found;
                })();
                if (!peekEntry || !peekEntry.isPenalty) {
                    showToast('Use the undo button to remove today\'s completion.', 'red'); return;
                }
            }
            if (entryDateStr < sevenDaysAgo) {
                showToast('Retroactive edits are limited to the last 7 days.', 'red'); return;
            }

            let foundActivity = null, foundDi = -1;
            const dims = window.userData.dimensions || [];
            outer: for (let di = 0; di < dims.length; di++) {
                for (let pi = 0; pi < (dims[di].paths || []).length; pi++) {
                    const ai = (dims[di].paths[pi].activities || []).findIndex(a => a.id === activityId);
                    if (ai !== -1) { foundActivity = dims[di].paths[pi].activities[ai]; foundDi = di; break outer; }
                }
            }
            if (!foundActivity) { showToast('Activity not found.', 'red'); return; }

            const idx = (foundActivity.completionHistory || []).findIndex(
                e => e.date === entryTimestamp
            );
            if (idx === -1) { showToast('Entry not found.', 'red'); return; }

            const isPenaltyEntry = !!foundActivity.completionHistory[idx].isPenalty;
            const deletedXP = foundActivity.completionHistory[idx].xp || 0;
            foundActivity.completionHistory.splice(idx, 1);
            // xpDelta: negate the stored xp value.
            // Normal entry: stored xp is positive → delta is negative (deduct from total).
            // Penalty entry: stored xp is negative → delta is positive (restore the deduction).
            await applyRetroactiveRecalculation(foundActivity, foundDi, -deletedXP);
            if (typeof renderHistoryEdit === 'function') renderHistoryEdit();
            renderActivityHistory(true);
            showToast(`↩ Removed entry for ${entryDateStr}`, 'blue');
        };

        // ── End Retroactive Write Functions ──────────────────────────────

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
                setTimeout(() => {
                    showRewardUnlock(newLevel);
                    // Inject share button into reward overlay after it opens
                    setTimeout(() => {
                        if (document.getElementById('shareLevelUpBtn')) return;
                        const card = document.querySelector('#rewardUnlockOverlay .reward-unlock-card');
                        if (!card) return;
                        const btn = document.createElement('button');
                        btn.id = 'shareLevelUpBtn';
                        btn.className = 'btn-reward-claim';
                        btn.style.cssText = 'margin-top:14px;background:linear-gradient(135deg,var(--color-accent-blue),var(--color-progress));display:inline-flex;align-items:center;gap:8px;font-size:15px;';
                        btn.innerHTML = '🚀 Share Progress';
                        btn.onclick = () => shareLevelUpCard(newLevel);
                        card.appendChild(btn);
                    }, 100);
                }, 600);
            } else {
                // Fallback toast — share button built in directly, no injection needed
                const levelUpToast = document.createElement('div');
                levelUpToast.style.cssText = [
                    'position:fixed', 'inset:0', 'display:flex', 'align-items:center',
                    'justify-content:center', 'z-index:10001', 'pointer-events:none'
                ].join(';') + ';';

                const inner = document.createElement('div');
                inner.style.cssText = [
                    'background:var(--color-bg-card)',
                    'border:1px solid var(--color-accent-blue)',
                    'color:#fff',
                    'padding:28px 44px',
                    'border-radius:24px',
                    'box-shadow:0 16px 56px rgba(0,0,0,0.65)',
                    'animation:levelUpPop 0.45s cubic-bezier(0.34,1.56,0.64,1) both',
                    'text-align:center',
                    'max-width:90vw',
                    'letter-spacing:-0.02em',
                    'display:flex',
                    'flex-direction:column',
                    'align-items:center',
                    'gap:10px',
                    'pointer-events:all'
                ].join(';') + ';';

                // Emoji
                const emoji = document.createElement('span');
                emoji.style.cssText = 'font-size:clamp(30px,9vw,52px);line-height:1;';
                emoji.textContent = '🎉';

                // Level text
                const levelText = document.createElement('span');
                levelText.style.cssText = 'font-weight:800;font-size:clamp(22px,7vw,38px);';
                levelText.textContent = 'Level ' + newLevel + '!';

                // Share button — built in, never injected
                const shareBtn = document.createElement('button');
                shareBtn.id = 'shareLevelUpBtn';
                shareBtn.style.cssText = [
                    'margin-top:4px',
                    'padding:10px 22px',
                    'background:linear-gradient(135deg,var(--color-accent-blue),var(--color-progress))',
                    'color:#fff',
                    'border:none',
                    'border-radius:20px',
                    'font-size:15px',
                    'font-weight:600',
                    'cursor:pointer',
                    'font-family:inherit',
                    'display:inline-flex',
                    'align-items:center',
                    'gap:8px',
                    'pointer-events:all'
                ].join(';') + ';';
                shareBtn.innerHTML = '🚀 Share Progress';
                shareBtn.onclick = function(e) {
                    e.stopPropagation();
                    shareLevelUpCard(newLevel);
                };

                inner.appendChild(emoji);
                inner.appendChild(levelText);
                inner.appendChild(shareBtn);
                levelUpToast.appendChild(inner);
                document.body.appendChild(levelUpToast);
                setTimeout(() => levelUpToast.remove(), 8000);
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
            view: 'all',           // all | dimension | path | activity
            period: 'all',         // 7d | 30d | all
            dimId: null,
            pathId: null,
            activityId: null,
            chartMode: 'cumulative', // cumulative | daily
            chartTimeRange: 'all',   // 1m | 3m | 6m | 1y | all  (chart-only zoom)
            chartOverlays: [],        // [{label, color?, dimId?, pathId?, actId?}]
        };
        window.calendarOffset = 0; // months relative to current
        window.xpChartInstance = null;

        // Palette for multi-series chart lines
        const CHART_LINE_COLORS  = ['#5a9fd4', '#6dbf7e', '#e0a050', '#e05c7a', '#9b6db5'];
        const CHART_FILL_COLORS  = [
            'rgba(74,124,158,0.35)',  'rgba(107,191,126,0.20)',
            'rgba(224,160,80,0.20)',  'rgba(224,92,122,0.20)',  'rgba(155,109,181,0.20)'
        ];

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
            renderXPChart(window._analyticsFullLog);
        };

        // ── Main Render ──────────────────────────────────────────────────

        // ── History Edit UI (Phase 3) ─────────────────────────────────────

        function renderHistoryEdit() {
            const container = document.getElementById('historyEditList');
            if (!container) return;

            const days = [];
            for (let i = 1; i <= 7; i++) {
                const d = new Date(Date.now() - i * 86400000);
                days.push(toLocalDateStr(d));
            }
            // Also include today for penalty entries (penalties can be stamped today at login)
            const todayStr = localToday();
            const allDays = [todayStr, ...days];

            const allActs = [];
            (window.userData.dimensions || []).forEach(dim =>
                (dim.paths || []).forEach(path =>
                    (path.activities || []).forEach(act => {
                        if (act.frequency !== 'occasional') allActs.push(act);
                    })
                )
            );

            // Build dayMap for past 7 days (completions) + today (penalties only)
            const dayMap = {};
            allDays.forEach(d => { dayMap[d] = []; });
            allActs.forEach(act => {
                (act.completionHistory || []).forEach(e => {
                    const d = toLocalDateStr(new Date(e.date));
                    if (!dayMap[d]) return;
                    // For today's slot: only show penalty entries (completions use undo)
                    if (d === todayStr && !e.isPenalty) return;
                    dayMap[d].push({
                        activityId: act.id,
                        activityName: act.name,
                        entryTimestamp: e.date,
                        xp: e.xp,
                        isPenalty: !!e.isPenalty
                    });
                });
            });

            const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

            // Only render days that have something to show (or are in the past-7 window)
            // Today only appears if it has penalty entries
            const daysToRender = [];
            if (dayMap[todayStr] && dayMap[todayStr].length > 0) daysToRender.push(todayStr);
            days.forEach(d => daysToRender.push(d));

            container.innerHTML = daysToRender.map(dateStr => {
                const entries = dayMap[dateStr] || [];
                const date = new Date(dateStr + 'T12:00:00');
                const isToday = dateStr === todayStr;
                const label = isToday
                    ? `Today — penalties`
                    : `${dayNames[date.getDay()]} ${date.getDate()} ${date.toLocaleString('default', { month: 'short' })}`;

                const entryRows = entries.length > 0
                    ? entries.map(e => {
                        const isPen = e.isPenalty;
                        return `
                        <div class="history-entry-row${isPen ? ' history-entry-penalty' : ''}">
                            <span class="history-entry-name">${escapeHtml(e.activityName)}${isPen ? ' <span class="history-penalty-tag">penalty</span>' : ''}</span>
                            <span class="history-entry-xp${isPen ? ' history-entry-xp-neg' : ''}">${isPen ? '' : '+'}${e.xp} XP</span>
                            <button class="history-entry-delete"
                                onclick="confirmRetroDelete('${e.activityId}','${e.entryTimestamp}',${isPen})"
                                title="${isPen ? 'Remove this penalty' : 'Remove this entry'}">✕</button>
                        </div>`;
                    }).join('')
                    : `<div class="history-empty-day">Nothing logged</div>`;

                return `
                <div class="history-day-row">
                    <div class="history-day-header">
                        <span class="history-day-label">${label}</span>
                        ${isToday ? '' : `<button class="history-day-add" onclick="openRetroPicker('${dateStr}')">+ Add missed</button>`}
                    </div>
                    ${entryRows}
                </div>`;
            }).join('');
        }

        // Store current dateStr for the picker so filterRetroPicker can use it
        let _retroPickerDateStr = null;

        window.openRetroPicker = function(dateStr) {
            const modal  = document.getElementById('retroPickerModal');
            const list   = document.getElementById('retroPickerList');
            const title  = document.getElementById('retroPickerTitle');
            const search = document.getElementById('retroPickerSearch');
            if (!modal || !list) return;

            _retroPickerDateStr = dateStr;
            const date = new Date(dateStr + 'T12:00:00');
            const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
            title.textContent = `${dayNames[date.getDay()]}, ${date.getDate()} ${date.toLocaleString('default',{month:'long'})}`;

            if (search) search.value = '';
            renderRetroPickerList(dateStr, '');
            modal.classList.add('active');
            if (search) setTimeout(() => search.focus(), 120);
        };

        function renderRetroPickerList(dateStr, query) {
            const list = document.getElementById('retroPickerList');
            if (!list) return;
            const q = (query || '').toLowerCase().trim();

            const dims = window.userData.dimensions || [];
            let html = '';
            let totalVisible = 0;

            dims.forEach(dim => {
                const dimActs = [];
                (dim.paths || []).forEach(path =>
                    (path.activities || []).forEach(act => {
                        if (act.frequency === 'occasional') return;
                        if (q && !act.name.toLowerCase().includes(q)) return;
                        const done = !act.allowMultiplePerDay && (act.completionHistory || []).some(
                            e => !e.isPenalty && toLocalDateStr(new Date(e.date)) === dateStr
                        );
                        dimActs.push({ act, done, pathName: path.name });
                    })
                );
                if (dimActs.length === 0) return;
                totalVisible += dimActs.length;

                html += `<div class="rp-dim-group">
                    <div class="rp-dim-label">${escapeHtml(dim.name)}</div>`;
                dimActs.forEach(({ act, done, pathName }) => {
                    html += `
                    <div class="rp-item${done ? ' rp-item-done' : ''}"
                         onclick="${done ? '' : `window._retroPickerAdd('${act.id}','${dateStr}')`}">
                        <div class="rp-item-left">
                            <span class="rp-item-name">${escapeHtml(act.name)}</span>
                            <span class="rp-item-path">${escapeHtml(pathName)}</span>
                        </div>
                        <div class="rp-item-right">
                            ${done
                                ? `<span class="rp-item-done-badge">✓ Done</span>`
                                : `<span class="rp-item-xp">+${act.baseXP} XP</span>
                                   <button class="rp-add-btn" onclick="event.stopPropagation();window._retroPickerAdd('${act.id}','${dateStr}')">Add</button>`
                            }
                        </div>
                    </div>`;
                });
                html += `</div>`;
            });

            if (totalVisible === 0) {
                html = `<div class="rp-empty">No activities found${q ? ' for "'+escapeHtml(q)+'"' : ''}.</div>`;
            }
            list.innerHTML = html;
        }

        window._retroPickerAdd = function(activityId, dateStr) {
            closeRetroPicker();
            retroactiveComplete(activityId, dateStr);
        };

        window.filterRetroPicker = function(query) {
            if (_retroPickerDateStr) renderRetroPickerList(_retroPickerDateStr, query);
        };

        window.closeRetroPicker = function() {
            const modal = document.getElementById('retroPickerModal');
            if (modal) modal.classList.remove('active');
            _retroPickerDateStr = null;
        };

        window.confirmRetroDelete = function(activityId, entryTimestamp, isPenalty) {
            const dateStr = toLocalDateStr(new Date(entryTimestamp));
            let name = 'this activity';
            (window.userData.dimensions || []).forEach(dim =>
                (dim.paths || []).forEach(path =>
                    (path.activities || []).forEach(act => { if (act.id === activityId) name = act.name; })
                )
            );
            const msg = isPenalty
                ? `Remove the missed-day penalty for "${name}"? The XP deduction will be restored.`
                : `Remove "${name}" from ${dateStr}? This will update your XP and streak.`;
            if (confirm(msg)) {
                retroactiveDelete(activityId, entryTimestamp).then(() => renderHistoryEdit());
            }
        };

        // ── End History Edit UI ───────────────────────────────────────────

        function renderAnalytics() {
            try { renderHistoryEdit(); } catch(e) { console.warn('renderHistoryEdit', e); }
            var allActs, filtered, fullLog, log;
            try { allActs  = getAllActivitiesFlat(); } catch(e) { allActs = []; console.warn('getAllActivitiesFlat', e); }
            try { filtered = filterByScope(allActs, window.analyticsState); } catch(e) { filtered = allActs; }
            try { fullLog  = getCompletionLog(filtered); } catch(e) { fullLog = []; console.warn('getCompletionLog', e); }
            // period-filtered log is used for summary cards, frequency, combos
            try { log      = filterByPeriod(fullLog, window.analyticsState.period); } catch(e) { log = fullLog; }
            window._analyticsLog     = log;     // period-filtered — cards, frequency, combos
            window._analyticsFullLog = fullLog; // full scope log — chart handles its own time range
            window._analyticsFiltered = filtered; // scope-filtered activities — for toggle re-renders

            try { renderAnalyticsSummary(filtered, log); } catch(e) { console.warn('renderAnalyticsSummary', e); }
            try { renderXPChart(fullLog); }                catch(e) { console.warn('renderXPChart', e); }
            try { renderXPLeaderboard(filtered, log); }    catch(e) { console.warn('renderXPLeaderboard', e); }
            try { renderStreakBoard(filtered); }            catch(e) { console.warn('renderStreakBoard', e); }
            try { renderFrequencyChart(filtered, log); }   catch(e) { console.warn('renderFrequencyChart', e); }
            try { renderCombosPanel(log); }                catch(e) { console.warn('renderCombosPanel', e); }
            try { renderCalendar(); }                      catch(e) { console.warn('renderCalendar', e); }
            try { populateChartOverlayDropdown(); }        catch(e) { console.warn('populateChartOverlayDropdown', e); }
            try { renderTimeOfDay(log); }                 catch(e) { console.warn('renderTimeOfDay', e); }
            try { renderDimProgress(); }                  catch(e) { console.warn('renderDimProgress outer', e); }
            try { renderActivityHistory(); }              catch(e) { console.warn('renderActivityHistory', e); }
        }

        // ── Summary Cards ────────────────────────────────────────────────

        function renderAnalyticsSummary(activities, log) {
            // Only count positive, user-initiated completions — exclude penalties & negative entries
            const positiveLog = log.filter(e => !e.isPenalty && (e.xp || 0) > 0);

            // Total XP earned: sum from period-filtered positive log
            const logXP = positiveLog.reduce((s, e) => s + (e.xp || 0), 0);
            // Ghost XP (from deleted activities) only applies to all-scope, all-time view
            const isAllScope  = window.analyticsState.view   === 'all';
            const isAllPeriod = window.analyticsState.period === 'all';
            const ghostXP = (isAllScope && isAllPeriod) ? (window.userData.xpDeletedGhost || 0) : 0;
            const totalXP = logXP + ghostXP;

            // Completions = positive entries in the period-filtered log
            const totalCompletions = positiveLog.length;

            // Weekly XP always reflects current calendar week for the selected scope
            const weeklyXP  = computeWeeklyXPFromActivities(activities);

            // XP/hour = yesterday's XP divided by 12 active hours (scope-aware)
            const xpPerHour = computeXPPerHour(activities);

            // Best all-time streak across scope activities
            const maxStreak = activities.reduce((s, a) => Math.max(s, a.bestStreak || a.streak || 0), 0);

            const el = document.getElementById('analyticsSummary');
            el.innerHTML = [
                { v: totalXP.toLocaleString(),          l: 'Total XP Earned' },
                { v: weeklyXP.toLocaleString(),         l: 'XP This Week'    },
                { v: xpPerHour.toLocaleString(),        l: 'XP / Hour'       },
                { v: totalCompletions.toLocaleString(), l: 'Completions'     },
                { v: activities.length,                 l: 'Activities'      },
                { v: maxStreak,                         l: 'Best Streak'     },
            ].map(s => `
                <div class="analytics-stat">
                    <div class="analytics-stat-value">${s.v}</div>
                    <div class="analytics-stat-label">${s.l}</div>
                </div>`).join('');
        }

        // ── XP Over Time Chart — multi-series canvas ─────────────────────

        function filterByTimeRange(log, range) {
            if (!range || range === 'all') return log;
            const cutoff = new Date();
            if      (range === '1m') cutoff.setMonth(cutoff.getMonth() - 1);
            else if (range === '3m') cutoff.setMonth(cutoff.getMonth() - 3);
            else if (range === '6m') cutoff.setMonth(cutoff.getMonth() - 6);
            else if (range === '1y') cutoff.setFullYear(cutoff.getFullYear() - 1);
            return log.filter(e => e.date >= cutoff);
        }

        function buildOverlayLog(ov) {
            const allActs = getAllActivitiesFlat();
            let acts = allActs;
            if      (ov.actId)  acts = allActs.filter(a => a.id       === ov.actId);
            else if (ov.pathId) acts = allActs.filter(a => a.pathId   === ov.pathId);
            else if (ov.dimId)  acts = allActs.filter(a => a.dimId    === ov.dimId);
            return getCompletionLog(acts);
        }

        function buildSeriesPoints(rawLog, mode) {
            let points = [];
            if (mode === 'cumulative') {
                let cum = 0;
                rawLog.forEach(e => { cum += (e.xp || 0); points.push({ date: e.date, val: cum }); });
            } else {
                const byDay = {};
                rawLog.forEach(e => {
                    const k = toLocalDateStr(e.date);
                    byDay[k] = (byDay[k] || 0) + (e.xp || 0);
                });
                Object.keys(byDay).sort().forEach(k => points.push({ date: new Date(k), val: byDay[k] }));
            }
            return points;
        }

        window.setChartTimeRange = function(range, btn) {
            window.analyticsState.chartTimeRange = range;
            const parent = btn.closest('.filter-pills');
            parent.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            renderXPChart(window._analyticsFullLog);
        };

        function populateChartOverlayDropdown() {
            const sel = document.getElementById('chartOverlayAdd');
            if (!sel) return;
            const dims = window.userData.dimensions || [];
            let html = '<option value="">+ Add series…</option>';
            if (dims.length) {
                html += '<optgroup label="── Dimensions">';
                dims.forEach(d => {
                    html += `<option value="dim:${d.id}:${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`;
                });
                html += '</optgroup>';
            }
            const allPaths = [];
            dims.forEach(d => (d.paths || []).forEach(p => allPaths.push({ d, p })));
            if (allPaths.length) {
                html += '<optgroup label="── Paths">';
                allPaths.forEach(({ d, p }) => {
                    html += `<option value="path:${p.id}:${escapeHtml(p.name)}">${escapeHtml(d.name)} › ${escapeHtml(p.name)}</option>`;
                });
                html += '</optgroup>';
            }
            const allActsFlat = getAllActivitiesFlat();
            if (allActsFlat.length) {
                html += '<optgroup label="── Activities">';
                allActsFlat.slice(0, 40).forEach(a => {
                    html += `<option value="act:${a.id}:${escapeHtml(a.name)}">${escapeHtml(a.name)}</option>`;
                });
                html += '</optgroup>';
            }
            // Preserve selected value after repopulate
            const prev = sel.value;
            sel.innerHTML = html;
            sel.value = prev;
        }

        window.addChartOverlay = function(sel) {
            const val = sel.value;
            if (!val) return;
            sel.value = ''; // reset immediately
            const overlays = window.analyticsState.chartOverlays;
            if (overlays.length >= 4) return; // cap at 4 overlay series

            const colonIdx1 = val.indexOf(':');
            const colonIdx2 = val.indexOf(':', colonIdx1 + 1);
            const type  = val.substring(0, colonIdx1);
            const id    = val.substring(colonIdx1 + 1, colonIdx2);
            const label = val.substring(colonIdx2 + 1);

            // Don't add duplicates
            if (overlays.find(o => (o.dimId || o.pathId || o.actId) === id)) return;

            const ov = { label };
            if      (type === 'dim')  ov.dimId  = id;
            else if (type === 'path') ov.pathId = id;
            else if (type === 'act')  ov.actId  = id;

            overlays.push(ov);
            renderOverlayChips();
            renderXPChart(window._analyticsFullLog);
        };

        window.removeChartOverlay = function(idx) {
            window.analyticsState.chartOverlays.splice(idx, 1);
            renderOverlayChips();
            renderXPChart(window._analyticsFullLog);
        };

        function renderOverlayChips() {
            const el = document.getElementById('chartOverlayChips');
            if (!el) return;
            const overlays = window.analyticsState.chartOverlays;
            if (!overlays.length) { el.innerHTML = ''; return; }
            el.innerHTML = overlays.map((ov, i) => {
                const color = CHART_LINE_COLORS[i + 1] || CHART_LINE_COLORS[4];
                return `<span class="chart-overlay-chip" style="border-color:${color};color:${color};">
                    <span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0;"></span>
                    ${escapeHtml(ov.label)}
                    <button onclick="removeChartOverlay(${i})" style="background:none;border:none;color:inherit;cursor:pointer;padding:0 0 0 2px;font-size:14px;line-height:1;vertical-align:middle;">×</button>
                </span>`;
            }).join('');
        }

        function renderXPChart(fullLog) {
            const empty  = document.getElementById('xpChartEmpty');
            const canvas = document.getElementById('xpChart');
            const legendEl = document.getElementById('chartLegend');
            if (!canvas) return;

            const mode      = window.analyticsState.chartMode;
            const timeRange = window.analyticsState.chartTimeRange || 'all';
            const overlays  = window.analyticsState.chartOverlays  || [];

            // ── Build series ──────────────────────────────────────────────
            const mainLog    = filterByTimeRange(fullLog || [], timeRange);
            const mainPoints = buildSeriesPoints(mainLog, mode);

            const seriesData = [
                { points: mainPoints, color: CHART_LINE_COLORS[0], fillColor: CHART_FILL_COLORS[0], label: 'Overall' },
                ...overlays.map((ov, i) => {
                    const ovLog    = filterByTimeRange(buildOverlayLog(ov), timeRange);
                    const ovPoints = buildSeriesPoints(ovLog, mode);
                    return {
                        points:    ovPoints,
                        color:     CHART_LINE_COLORS[i + 1]    || CHART_LINE_COLORS[4],
                        fillColor: CHART_FILL_COLORS[i + 1]    || CHART_FILL_COLORS[4],
                        label:     ov.label,
                    };
                }),
            ].filter(s => s.points.length > 0);

            if (!seriesData.length || !mainPoints.length) {
                canvas.style.display  = 'none';
                empty.style.display   = 'flex';
                if (legendEl) legendEl.style.display = 'none';
                return;
            }
            empty.style.display  = 'none';
            canvas.style.display = 'block';

            // ── Canvas sizing ─────────────────────────────────────────────
            const _rect = canvas.getBoundingClientRect();
            const W = (_rect.width  > 0 ? _rect.width  : canvas.offsetWidth)  || 600;
            const H = (_rect.height > 0 ? _rect.height : canvas.offsetHeight) || 220;
            canvas.width  = W;
            canvas.height = H;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, W, H);

            const pad = { top: 20, right: 20, bottom: 36, left: 52 };
            const cW = W - pad.left - pad.right;
            const cH = H - pad.top - pad.bottom;

            // ── Global coordinate ranges (union across all series) ────────
            const allDates = seriesData.flatMap(s => s.points.map(p => p.date.getTime()));
            const allVals  = seriesData.flatMap(s => s.points.map(p => p.val));
            const minDate  = Math.min(...allDates);
            const maxDate  = Math.max(...allDates);
            const dateRange = (maxDate - minDate) || 1;
            const maxVal   = Math.max(...allVals, 1);
            const minVal   = Math.min(0, ...allVals);
            const valRange = (maxVal - minVal) || 1;

            const px = d => pad.left + ((d.getTime() - minDate) / dateRange) * cW;
            const py = v => pad.top  + cH - ((v - minVal) / valRange) * cH;

            // ── Grid lines ────────────────────────────────────────────────
            ctx.strokeStyle = 'rgba(255,255,255,0.05)';
            ctx.lineWidth = 1;
            for (let i = 0; i <= 4; i++) {
                const y = pad.top + (cH / 4) * i;
                ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y); ctx.stroke();
                const label = Math.round(maxVal - (maxVal - minVal) * i / 4);
                ctx.fillStyle = 'rgba(176,176,176,0.7)';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(label >= 1000 ? (label / 1000).toFixed(1) + 'k' : label, pad.left - 6, y + 4);
            }

            // ── Draw each series ──────────────────────────────────────────
            seriesData.forEach((series, si) => {
                const { points, color, fillColor } = series;
                if (!points.length) return;

                // Fill gradient — main series only
                if (si === 0) {
                    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
                    grad.addColorStop(0, fillColor);
                    grad.addColorStop(1, 'rgba(74,124,158,0)');
                    ctx.beginPath();
                    ctx.moveTo(px(points[0].date), py(points[0].val));
                    points.forEach(p => ctx.lineTo(px(p.date), py(p.val)));
                    ctx.lineTo(px(points[points.length - 1].date), py(minVal));
                    ctx.lineTo(px(points[0].date), py(minVal));
                    ctx.closePath();
                    ctx.fillStyle = grad;
                    ctx.fill();
                }

                // Line
                ctx.beginPath();
                ctx.moveTo(px(points[0].date), py(points[0].val));
                points.forEach(p => ctx.lineTo(px(p.date), py(p.val)));
                ctx.strokeStyle = color;
                ctx.lineWidth   = si === 0 ? 2.5 : 2;
                ctx.lineJoin    = 'round';
                ctx.setLineDash(si === 0 ? [] : [5, 3]);
                ctx.stroke();
                ctx.setLineDash([]);

                // Dots (always for overlays; main only when ≤40 points)
                const dotRadius = si === 0 ? 3.5 : 3;
                if (si > 0 || points.length <= 40) {
                    points.forEach(p => {
                        ctx.beginPath();
                        ctx.arc(px(p.date), py(p.val), dotRadius, 0, Math.PI * 2);
                        ctx.fillStyle = color;
                        ctx.fill();
                    });
                }
            });

            // ── X-axis labels ─────────────────────────────────────────────
            ctx.fillStyle = 'rgba(176,176,176,0.7)';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            const formatDate = d => `${d.getMonth() + 1}/${d.getDate()}`;
            const refPts = seriesData[0].points;
            if (refPts.length === 1) {
                ctx.fillText(formatDate(refPts[0].date), px(refPts[0].date), H - 8);
            } else {
                const maxLabels = Math.min(6, refPts.length);
                const labelIndices = new Set([0, refPts.length - 1]);
                if (maxLabels > 2) {
                    const step = (refPts.length - 1) / (maxLabels - 1);
                    for (let i = 1; i < maxLabels - 1; i++) labelIndices.add(Math.round(i * step));
                }
                let lastLabelX = -Infinity;
                [...labelIndices].sort((a, b) => a - b).forEach(i => {
                    const p = refPts[i];
                    const x = px(p.date);
                    if (x - lastLabelX >= 40) {
                        ctx.fillText(formatDate(p.date), x, H - 8);
                        lastLabelX = x;
                    }
                });
            }

            // ── Legend (shown when there are overlays) ────────────────────
            if (legendEl) {
                const hasOverlays = overlays.length > 0;
                legendEl.style.display = hasOverlays ? 'flex' : 'none';
                if (hasOverlays) {
                    legendEl.innerHTML = seriesData.map((s, i) => `
                        <div class="chart-legend-item">
                            <span style="display:inline-block;width:22px;height:3px;background:${s.color};border-radius:2px;${i>0?'border-top:2px dashed '+s.color+';background:none;height:0;':''}"></span>
                            <span style="font-size:11px;color:var(--color-text-secondary);">${escapeHtml(s.label)}</span>
                        </div>`).join('');
                }
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

        window.toggleFrequencyChart = function() {
            var body = document.getElementById('frequencyBody');
            var btn  = document.getElementById('frequencyToggleBtn');
            if (!body || !btn) return;
            var isOpen = body.classList.toggle('open');
            btn.classList.toggle('open', isOpen);
            if (isOpen) {
                try {
                    renderFrequencyChart(
                        window._analyticsFiltered || getAllActivitiesFlat(),
                        window._analyticsLog || []
                    );
                } catch(e) {}
            }
        };

        function renderFrequencyChart(activities, log) {
            const el = document.getElementById('frequencyChart');
            // Only count positive, user-initiated completions — skip penalties and negative XP
            const positiveLog = log.filter(e => !e.isPenalty && (e.xp || 0) > 0);
            const countMap = {};
            positiveLog.forEach(e => { countMap[e.activityId] = (countMap[e.activityId] || 0) + 1; });
            const ranked = activities
                .filter(a => countMap[a.id] > 0)
                .sort((a, b) => (countMap[b.id] || 0) - (countMap[a.id] || 0));
            if (ranked.length === 0) { el.innerHTML = '<div class="empty-state" style="padding:24px 0"><p>No data yet</p></div>'; return; }
            const max = countMap[ranked[0].id] || 1;
            const COLORS = { most: 'var(--color-accent-green)', least: 'var(--color-accent-red)', mid: 'var(--color-accent-blue)' };
            el.innerHTML = ranked.map((a, i) => {
                const color = i === 0 ? COLORS.most : i === ranked.length - 1 ? COLORS.least : COLORS.mid;
                const tag   = i === 0 ? ' 👑' : i === ranked.length - 1 ? ' 🐢' : '';
                return `<div class="rank-row">
                    <span class="rank-label" style="width:130px;" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}${tag}</span>
                    <div class="rank-bar-track">
                        <div class="rank-bar-fill" style="width:${((countMap[a.id] || 0) / max * 100).toFixed(1)}%;background:${color};"></div>
                    </div>
                    <span class="rank-value">${countMap[a.id] || 0}×</span>
                </div>`;
            }).join('');
        }

        // ── Activity Combos ───────────────────────────────────────────────

        window.toggleCombosPanel = function() {
            var body = document.getElementById('combosBody');
            var btn  = document.getElementById('combosToggleBtn');
            if (!body || !btn) return;
            var isOpen = body.classList.toggle('open');
            btn.classList.toggle('open', isOpen);
            if (isOpen) {
                try { renderCombosPanel(window._analyticsLog || []); } catch(e) {}
            }
        };

        function renderCombosPanel(log) {
            const el = document.getElementById('combosPanel');
            // Only consider positive, user-initiated completions — skip penalties and negative XP
            const positiveLog = log.filter(e => !e.isPenalty && (e.xp || 0) > 0);
            // Group completions by day
            const byDay = {};
            positiveLog.forEach(e => {
                const k = toLocalDateStr(e.date);
                if (!byDay[k]) byDay[k] = [];
                byDay[k].push(e.activityName);
            });
            const pairs = {};
            Object.values(byDay).forEach(names => {
                const uniq = [...new Set(names)];
                for (let i = 0; i < uniq.length; i++) {
                    for (let j = i + 1; j < uniq.length; j++) {
                        const key = [uniq[i], uniq[j]].sort().join(' + ');
                        pairs[key] = (pairs[key] || 0) + 1;
                    }
                }
            });
            const sorted = Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 6);
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
                </div>`;
            }).join('');
        }

        // ── Calendar ─────────────────────────────────────────────────────

        window.calendarNav = function(dir) {
            window.calendarOffset += dir;
            // Save current selection before re-render so month nav can't lose it
            var calSel = document.getElementById('calendarActivityFilter');
            if (calSel && calSel.value) window._calendarSelId = calSel.value;
            renderCalendar();
        };

        // Explicit refresh — reads current dropdown value and re-renders the calendar.
        // Called by the ↻ Refresh button so users can apply a newly selected activity.
        window.refreshCalendar = function() {
            var calSel = document.getElementById('calendarActivityFilter');
            if (calSel) window._calendarSelId = calSel.value;
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

            // Build day → [activities completed] map — positive completions only.
            // Penalties and negative-XP entries (e.g. "skip-penalty" habit) are excluded
            // so the calendar only lights up on days the user actually did the activity.
            const dayMap = {};
            filtered.forEach(act => {
                if (act.completionHistory && act.completionHistory.length) {
                    act.completionHistory.forEach(e => {
                        // Skip penalties and negative-XP skip deductions
                        if (e.isPenalty || (e.xp || 0) <= 0) return;
                        const k = toLocalDateStr(new Date(e.date));
                        if (!dayMap[k]) dayMap[k] = [];
                        dayMap[k].push({ name: act.name, xp: e.xp || act.baseXP });
                    });
                } else if (act.lastCompleted) {
                    // Fallback for activities that predate completionHistory recording
                    const k = toLocalDateStr(new Date(act.lastCompleted));
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
            const todayStr = localToday();

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
            if (!el) return;
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

            const todayStr      = localToday();
            const sevenDaysAgo  = toLocalDateStr(new Date(Date.now() - 7 * 86400000));

            // Build a flat log of all history entries across all activities
            const allActs = getAllActivitiesFlat();
            const rawLog = [];
            allActs.forEach(act => {
                (act.completionHistory || []).forEach(e => {
                    rawLog.push({
                        date:         new Date(e.date),
                        dateISO:      toLocalDateStr(new Date(e.date)),
                        xp:           e.xp || 0,
                        isPenalty:    !!e.isPenalty,
                        actName:      act.name,
                        activityId:   act.id,
                        entryTs:      e.date,
                        dimName:      act.dimName,
                        pathName:     act.pathName,
                    });
                });
            });
            // Include deleted activities so their history stays visible
            (window.userData.deletedActivityLog || []).forEach(entry => {
                (entry.completionHistory || []).forEach(e => {
                    rawLog.push({
                        date:      new Date(e.date),
                        dateISO:   toLocalDateStr(new Date(e.date)),
                        xp:        e.xp || 0,
                        isPenalty: !!e.isPenalty,
                        actName:   entry.name,
                        activityId: null,
                        entryTs:   e.date,
                        dimName:   entry.dimName || '',
                        pathName:  entry.pathName || '',
                        isDeleted: true,
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

            // Pre-compute daily XP totals across all filtered entries (not just visible page)
            // so the date header shows the correct sum even when some entries are on the next page.
            const dayXPMap = {};
            filtered.forEach(e => {
                const ds = e.date.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric', year:'numeric' });
                dayXPMap[ds] = (dayXPMap[ds] || 0) + (e.xp || 0);
            });

            // Group by calendar date for readability
            // Track which ISO dates we've already rendered a header for
            const renderedDateHeaders = new Set();
            let lastDateStr = '';
            let html = '';
            visible.forEach(e => {
                const dateStr = e.date.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric', year:'numeric' });
                if (dateStr !== lastDateStr) {
                    const dayXP    = dayXPMap[dateStr] || 0;
                    const dayXPStr = dayXP > 0 ? `+${dayXP}` : (dayXP < 0 ? `${dayXP}` : '±0');
                    const dayXPClr = dayXP > 0 ? '#6fcf97' : (dayXP < 0 ? '#e07070' : 'var(--color-text-secondary)');
                    // Show "+ Add missed" for past 7 days (not today — use activity card for today)
                    const isEditable = e.dateISO && e.dateISO < todayStr && e.dateISO >= sevenDaysAgo;
                    const addBtn = isEditable
                        ? `<button class="ah-add-btn" onclick="openRetroPicker('${e.dateISO}')">+ Add</button>`
                        : '';
                    html += `<div class="ah-date-header">
                        <span>${dateStr}</span>
                        <div style="display:flex;align-items:center;gap:8px;">
                            ${addBtn}
                            <span style="color:${dayXPClr};font-size:11px;font-weight:700;">${dayXPStr} XP</span>
                        </div>
                    </div>`;
                    lastDateStr = dateStr;
                    if (e.dateISO) renderedDateHeaders.add(e.dateISO);
                }
                const timeStr = e.date.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
                const isPos   = e.xp >= 0;
                const xpLabel = (isPos ? '+' : '') + e.xp + ' XP';
                const xpClass = isPos ? 'pos' : 'neg';
                const deletedTag = e.isDeleted
                    ? `<span class="ah-tag" style="background:rgba(160,100,50,0.13);color:#b8804a;border-color:rgba(160,100,50,0.22);">† deleted</span>`
                    : '';
                const tag = !e.isDeleted && e.isPenalty
                    ? `<span class="ah-tag ah-tag-penalty">⚡ auto-penalty</span>`
                    : (!e.isDeleted && !isPos ? `<span class="ah-tag ah-tag-negative">−habit</span>` : '');
                // Delete button: editable if within 7 days, not deleted, not today's non-penalty
                const canDelete = !e.isDeleted && e.activityId &&
                    e.dateISO >= sevenDaysAgo &&
                    (e.isPenalty || e.dateISO < todayStr);
                const delBtn = canDelete
                    ? `<button class="ah-del-btn" onclick="confirmRetroDelete('${e.activityId}','${e.entryTs}',${e.isPenalty})" title="Remove entry">✕</button>`
                    : '';
                html += `
                <div class="ah-row${e.isDeleted ? ' ah-row-deleted' : ''}${canDelete ? ' ah-row-editable' : ''}">
                    <span class="ah-xp ${xpClass}">${xpLabel}</span>
                    <span class="ah-name" title="${escapeHtml(e.actName)}">${escapeHtml(e.actName)}</span>
                    ${deletedTag}${tag}
                    <span class="ah-meta">${timeStr}</span>
                    ${delBtn}
                </div>`;
            });

            // For past 7 days with zero entries visible (not in history yet), inject stub headers
            // so users can still "+ Add missed" even if no entries exist for that day
            const stubDays = [];
            for (let i = 1; i <= 7; i++) {
                const d = new Date(Date.now() - i * 86400000);
                const iso = toLocalDateStr(d);
                if (!renderedDateHeaders.has(iso)) {
                    stubDays.push({ iso, label: d.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric', year:'numeric' }) });
                }
            }
            if (stubDays.length > 0 && (window._historyFilter === 'all' || window._historyFilter === 'positive')) {
                html += stubDays.map(s => `
                <div class="ah-date-header ah-date-stub">
                    <span style="opacity:0.45;">${s.label}</span>
                    <button class="ah-add-btn" onclick="openRetroPicker('${s.iso}')">+ Add missed</button>
                </div>`).join('');
            }

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

        // ── Retroactive Recalculation Engine (Phase 1) ───────────────────

        function recomputeActivityCounters(activity) {
            const userEntries = (activity.completionHistory || []).filter(e => !e.isPenalty);
            activity.completionCount = userEntries.length;
            activity.totalXP = userEntries.reduce((sum, e) => sum + Math.abs(e.xp || 0), 0);
        }

        function recomputeTotalXPFromHistory() {
            let total = 0;
            (window.userData.dimensions || []).forEach(dim =>
                (dim.paths || []).forEach(path =>
                    (path.activities || []).forEach(act => {
                        (act.completionHistory || []).forEach(e => {
                            if (!e.isPenalty) total += Math.abs(e.xp || 0);
                            else total += (e.xp || 0); // penalties are negative — permanently deduct
                        });
                    })
                )
            );
            total += (window.userData.xpDeletedGhost || 0);
            return total;
        }

        function recomputeLevelFromTotalXP(totalXP) {
            let level = 1;
            let remaining = Math.max(0, totalXP);
            while (level < 100) {
                const threshold = calculateXPForLevel(level);
                if (remaining < threshold) break;
                remaining -= threshold;
                level++;
            }
            if (level >= 100) { level = 100; remaining = 0; }
            return { level, currentXP: remaining };
        }

        function recomputeDimXP(dim) {
            initDim(dim);
            let total = 0;
            (dim.paths || []).forEach(path =>
                (path.activities || []).forEach(act => {
                    (act.completionHistory || []).filter(e => !e.isPenalty)
                        .forEach(e => { total += Math.abs(e.xp || 0); });
                })
            );
            dim.dimTotalXP = total;
            let remaining = total;
            let dimLevel = 1;
            while (dimLevel < 100) {
                const threshold = calculateDimXPForLevel(dimLevel);
                if (remaining < threshold) break;
                remaining -= threshold;
                dimLevel++;
            }
            if (dimLevel >= 100) { dimLevel = 100; remaining = 0; }
            dim.dimLevel = dimLevel;
            dim.dimXP = remaining;
        }

        // ── recomputeStreakFromHistory ────────────────────────────────────
        // Called after every retroactive history edit (add or delete) to
        // rebuild streak / shields / streakStartWindow PURELY from the now-
        // current completionHistory. Always forward-walks from the oldest
        // verifiable window and lets the break-and-restart logic find the
        // most recent contiguous streak segment.
        //
        // CRITICAL: does NOT use activity.streakStartWindow as a floor.
        // After a retro edit, that anchor is stale — it was stamped before
        // the edit. A retro ADD older than today should extend the streak
        // backwards; a retro DELETE of the current streak's start should
        // move the anchor forward. The whole point of "recompute" is to
        // re-derive these from history, not to be constrained by them.
        //
        // Mirrors the algorithm in processStreakSystem (forward walk through
        // closed windows, hit→++, miss→shield-or-break) but uses an unrestricted
        // walk floor so any retro-edit shape is handled correctly.
        function recomputeStreakFromHistory(activity) {
            if (activity.frequency === 'occasional') return;
            if (activity.isNegative && !activity.isSkipNegative) return;

            // completionHistory is kept sorted after every write — no re-sort needed here
            const userHistory = (activity.completionHistory || []).filter(
                e => !e.isPenalty && (e.xp || 0) !== 0
            );

            if (userHistory.length === 0) {
                activity.lastCompleted = null;
                activity.streak = 0;
                activity.shieldsConsumed = 0;
                activity.streakStartWindow = null;
                activity.streakGrantedDate = null;
                activity.shieldCapUsed = BASE_SHIELDS;
                return;
            }
            activity.lastCompleted = userHistory[userHistory.length - 1].date;

            const todayStr = localToday();
            const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
            const todayWindow = getCycleWindowStart(activity, todayMidnight);
            if (!todayWindow) return;

            // Build cheat sheet: one pass over history → Set of window-start
            // timestamps that have at least one completion. Each walk step
            // becomes an O(1) Set.has() lookup.
            const completedWindowSet = new Set();
            userHistory.forEach(e => {
                const w = getCycleWindowStart(activity, new Date(e.date));
                if (w) completedWindowSet.add(w.getTime());
            });
            const hasTodayCompletion = completedWindowSet.has(todayWindow.getTime());

            // Edge case — no closed window exists yet (brand-new activity, today is first window).
            const cursor = getCycleWindowStart(activity, new Date(todayWindow.getTime() - 1));
            if (!cursor) {
                activity.streak = hasTodayCompletion ? 1 : 0;
                activity.shieldsConsumed = 0;
                activity.streakStartWindow = hasTodayCompletion ? todayStr : null;
                activity.streakGrantedDate = hasTodayCompletion ? todayStr : null;
                activity.shieldCapUsed = BASE_SHIELDS;
                activity.bestStreak = Math.max(activity.bestStreak || 0, activity.streak);
                return;
            }

            // ── Walk floor (oldest window we can verify) ──────────────────
            // Use whichever is more recent of: activity creation, oldest
            // history entry. We deliberately do NOT include the stored
            // streakStartWindow — see header comment.
            const actCreated = new Date(activity.createdAt || userHistory[0].date);
            actCreated.setHours(0, 0, 0, 0);
            const actCreatedWindow = getCycleWindowStart(activity, actCreated) || actCreated;
            const historyFloorWindow = getCycleWindowStart(activity, new Date(userHistory[0].date)) || actCreatedWindow;
            const walkFloor = (historyFloorWindow > actCreatedWindow) ? historyFloorWindow : actCreatedWindow;

            let streak = 0;
            let shieldsConsumed = 0;
            let walkCapUsed = BASE_SHIELDS;
            let streakStartWindow = null;
            const MAX_WALK = 400;

            // ── Forward walk through closed windows ───────────────────────
            // Hit  → streak++ (and remember oldest hit of this segment).
            // Miss → consume shield if any are left; otherwise BREAK and reset
            //        (a later hit will start a fresh segment with full shields).
            let fwdCursor = walkFloor;
            for (let i = 0; i < MAX_WALK; i++) {
                if (!fwdCursor || fwdCursor.getTime() >= todayWindow.getTime()) break;
                const nextWin = getNextCycleWindowStart(activity, fwdCursor);
                if (!nextWin) break;
                const hit = completedWindowSet.has(fwdCursor.getTime());
                if (hit) {
                    streak++;
                    if (!streakStartWindow) streakStartWindow = fwdCursor;
                    if (SHIELD_MILESTONES.includes(streak))
                        walkCapUsed = Math.min(SHIELD_ABS_CAP, walkCapUsed + 1);
                } else if (streak > 0 && (walkCapUsed - shieldsConsumed) > 0) {
                    shieldsConsumed++;
                } else if (streak > 0) {
                    // Unshielded miss — streak breaks. Reset; later hits start fresh.
                    streak = 0; shieldsConsumed = 0; walkCapUsed = BASE_SHIELDS;
                    streakStartWindow = null;
                }
                // streak===0 + miss: no active streak to protect, skip silently.
                fwdCursor = nextWin;
            }

            // ── Today's completion (open window — never visited by walk) ──
            if (hasTodayCompletion) {
                if (streak === 0) {
                    // Fresh streak that begins today.
                    shieldsConsumed = 0;
                    walkCapUsed = BASE_SHIELDS;
                    streakStartWindow = todayWindow;
                }
                streak++;
                if (SHIELD_MILESTONES.includes(streak))
                    walkCapUsed = Math.min(SHIELD_ABS_CAP, walkCapUsed + 1);
            }

            activity.streak = streak;
            activity.shieldsConsumed = streak > 0 ? shieldsConsumed : 0;
            activity.bestStreak = Math.max(activity.bestStreak || 0, streak);
            activity.streakStartWindow = streakStartWindow ? toLocalDateStr(streakStartWindow) : null;
            activity.streakGrantedDate = hasTodayCompletion ? todayStr : null;
            activity.shieldCapUsed = streak > 0 ? walkCapUsed : BASE_SHIELDS;
        }

        function recomputeChallengeProgress(activityId) {
            const challenges = window.userData.challenges || [];
            let activity = null;
            (window.userData.dimensions || []).forEach(dim =>
                (dim.paths || []).forEach(path =>
                    (path.activities || []).forEach(act => {
                        if (act.id === activityId) activity = act;
                    })
                )
            );
            if (!activity) return;

            challenges.forEach(challenge => {
                if (challenge.status !== 'active') return;
                const challengeActivityIds = challenge.activityIds && challenge.activityIds.length > 0
                    ? challenge.activityIds
                    : (challenge.activityId ? [challenge.activityId] : []);
                if (!challengeActivityIds.includes(activityId)) return;

                const entries = (activity.completionHistory || []).filter(e => {
                    if (e.isPenalty) return false;
                    const d = toLocalDateStr(new Date(e.date));
                    if (challenge.startDate && d < challenge.startDate) return false;
                    if (challenge.endDate && d > challenge.endDate) return false;
                    return true;
                });
                const count = entries.length;

                if (challenge.activityTargets && challenge.activityTargets[activityId] !== undefined) {
                    if (!challenge.activityProgress) challenge.activityProgress = {};
                    challenge.activityProgress[activityId] = count;
                    challenge.currentCount = challengeActivityIds.reduce((sum, id) => {
                        const target = challenge.activityTargets[id] || 1;
                        return sum + Math.min((challenge.activityProgress || {})[id] || 0, target);
                    }, 0);
                } else {
                    let total = 0;
                    challengeActivityIds.forEach(id => {
                        let linkedAct = null;
                        (window.userData.dimensions || []).forEach(dim =>
                            (dim.paths || []).forEach(path =>
                                (path.activities || []).forEach(a => { if (a.id === id) linkedAct = a; })
                            )
                        );
                        if (!linkedAct) return;
                        total += (linkedAct.completionHistory || []).filter(e => {
                            if (e.isPenalty) return false;
                            const d = toLocalDateStr(new Date(e.date));
                            if (challenge.startDate && d < challenge.startDate) return false;
                            if (challenge.endDate && d > challenge.endDate) return false;
                            return true;
                        }).length;
                    });
                    challenge.currentCount = total;
                }
            });
        }

        // ── End Retroactive Recalculation Engine ──────────────────────────

        // ── Write budget management ───────────────────────────────────────────
        // Firestore free tier: 20,000 document writes/day across all users.
        // We fold the daily backup INSIDE the main save (one setDoc, not two).
        // _backupSavedDate gates this so the snapshot is only embedded once per day.
        let _backupSavedDate = null;

        async function saveUserData() {
            if (!window.currentUser) return;
            try {
                const userDocRef = doc(db, 'users', window.currentUser.uid);
                const today = localToday();
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
                // Keep the public profile in sync — non-blocking, failure is safe to ignore
                syncPublicProfile();
            } catch (error) {
                console.error('Error saving data:', error);
                alert('Failed to save data. Please try again.');
            }
        }

        // ── Debounced save for fire-and-forget callers ──────────────────
        // Coalesces rapid saves (e.g. quick complete → undo → re-complete)
        // into a single Firestore write. Since saveUserData always writes
        // window.userData (latest in-memory state), only the last save matters.
        let _saveDebounceTimer = null;
        function debouncedSaveUserData() {
            clearTimeout(_saveDebounceTimer);
            _saveDebounceTimer = setTimeout(() => { saveUserData(); }, 200);
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

        const STREAK_MILESTONES = [7, 14, 25, 30, 50, 60, 75, 100];
        function checkStreakMilestone(activityName, streak) {
            if (!STREAK_MILESTONES.includes(streak)) return;
            const isShieldTier = SHIELD_MILESTONES.includes(streak);
            const emojis = { 7:'🔥', 14:'⚡', 25:'🛡', 30:'🌟', 50:'🛡', 60:'💎', 75:'🛡', 100:'👑' };
            _showToastPill({
                icon: emojis[streak] || '🔥',
                label: isShieldTier
                    ? `${streak}-day streak! +1 shield earned • ${activityName}`
                    : `${streak}-day streak! ${activityName}`,
                accent:    isShieldTier ? 'rgba(20,60,100,0.95)'  : 'rgba(90,60,10,0.95)',
                accentEnd: isShieldTier ? 'rgba(40,120,190,0.95)' : 'rgba(180,120,20,0.95)',
                border:    isShieldTier ? 'rgba(90,159,212,0.55)' : 'rgba(255,180,50,0.5)',
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

        // Tab switching
        window.switchTab = function(tabName) {
            // Block access to tabs locked behind level thresholds. Surface the
            // unlock requirement as a toast and don't change tabs.
            if (typeof isTabUnlocked === 'function' && !isTabUnlocked(tabName)) {
                const meta = TAB_UNLOCKS[tabName];
                if (meta) {
                    showToast(`🔒 ${meta.label} unlocks at Level ${meta.level}`, 'olive');
                }
                return;
            }
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

            // Show/hide stats grid — visible on Analytics tab only
            const statsGrid = document.querySelector('.stats-grid');
            if (statsGrid) statsGrid.style.display = (tabName === 'analytics') ? '' : 'none';

            // Render the newly-visible tab (skipped during updateDashboard if not active)
            if (tabName === 'challenges') renderChallenges();
            else if (tabName === 'friends') renderFriendsTab();
            else if (tabName === 'settings') { loadSettings(); }
            else if (tabName === 'analytics') {
                renderAnalytics();
                // Belt-and-suspenders: ensure dim progress renders even if renderAnalytics threw
                setTimeout(function() { try { renderDimProgress(); } catch(e) {} }, 50);
            }
            // Render sub-tab content for tabs that have sub-tabs
            if (tabName === 'activities') {
                var activeSub = document.querySelector('#activitiesSubTabs .sub-tab.active');
                if (activeSub) {
                    var subName = activeSub.getAttribute('onclick').match(/switchSubTab\('activities','(\w+)'\)/);
                    if (subName && subName[1] === 'categories') renderDimensions();
                    else if (subName && subName[1] === 'myActivities') renderActivitiesList();
                } else {
                    renderActivitiesList();
                }
            }
        };

        // ── Sub-tab navigation ────────────────────────────────────────────
        window.switchSubTab = function(parentTab, subTab) {
            // Map sub-tab names to their DOM id suffixes (capitalised)
            var parentEl = document.getElementById(parentTab + 'Tab');
            if (!parentEl) return;

            // Update sub-tab pill buttons
            var subTabs = parentEl.querySelectorAll('.sub-tab');
            subTabs.forEach(function(btn) { btn.classList.remove('active'); });
            // Find the clicked one by matching the onclick content
            subTabs.forEach(function(btn) {
                if (btn.getAttribute('onclick') === "switchSubTab('" + parentTab + "','" + subTab + "')") {
                    btn.classList.add('active');
                }
            });

            // Build the panel ID from parentTab + sub-tab name with capital first letter
            var panelId = parentTab + 'Sub' + subTab.charAt(0).toUpperCase() + subTab.slice(1);
            var panels = parentEl.querySelectorAll('.sub-tab-content');
            panels.forEach(function(p) { p.style.display = 'none'; });
            var target = document.getElementById(panelId);
            if (target) target.style.display = '';

            // Trigger renders for content-heavy sub-tabs
            if (parentTab === 'activities' && subTab === 'categories') renderDimensions();
        };

        // ── Profile Rewards toggle ───────────────────────────────────────
        window.toggleProfileRewards = function() {
            var body = document.getElementById('profileRewardsBody');
            var chevron = document.getElementById('profileRewardsChevron');
            if (!body) return;
            var isOpen = body.style.display !== 'none';
            body.style.display = isOpen ? 'none' : 'block';
            if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
            // Render rewards content when opening
            if (!isOpen) {
                renderRewards();
            }
        };

        // ══════════════════════════════════════════════════════════════════
        // ── Daily Planner ──────────────────────────────────────────────────
        // ══════════════════════════════════════════════════════════════════

        // ── State ──
        function localDateStr(d) {
            var dt = d || new Date();
            var y = dt.getFullYear();
            var m = (dt.getMonth() + 1 < 10 ? '0' : '') + (dt.getMonth() + 1);
            var dd = (dt.getDate() < 10 ? '0' : '') + dt.getDate();
            return y + '-' + m + '-' + dd;
        }
        window._plannerDate = localDateStr();

        function ensurePlannerData() {
            if (!window.userData.planner) window.userData.planner = {};
            if (!window.userData.planner.recurring) window.userData.planner.recurring = [];
            if (!window.userData.planner.days) window.userData.planner.days = {};
        }

        function getPlannerDay(dateStr) {
            ensurePlannerData();
            if (!window.userData.planner.days[dateStr]) {
                window.userData.planner.days[dateStr] = { items: [], skipRecurring: [] };
            }
            return window.userData.planner.days[dateStr];
        }

        // ── Date navigation ──
        window.plannerDateNav = function(delta) {
            var d = new Date(window._plannerDate + 'T12:00:00');
            d.setDate(d.getDate() + delta);
            window._plannerDate = localDateStr(d);
            renderPlanner();
        };

        window.setPlannerDate = function(val) {
            if (!val) {
                window._plannerDate = localDateStr();
            } else {
                window._plannerDate = val;
            }
            renderPlanner();
        };

        // ── Render ──
        function renderPlanner() {
            var dateStr = window._plannerDate;
            var todayStr = localDateStr();

            // Date label
            var labelEl = document.getElementById('plannerDateLabel');
            if (labelEl) {
                if (dateStr === todayStr) {
                    labelEl.textContent = 'Today — ' + formatPlannerDate(dateStr);
                } else {
                    labelEl.textContent = formatPlannerDate(dateStr);
                }
            }

            // Date picker sync
            var picker = document.getElementById('plannerDatePicker');
            if (picker) picker.value = dateStr;

            // Today button visibility
            var todayBtn = document.getElementById('plannerTodayBtn');
            if (todayBtn) todayBtn.style.display = dateStr === todayStr ? 'none' : '';

            // Merge recurring + day-specific items
            ensurePlannerData();
            var dayData = getPlannerDay(dateStr);
            var skipSet = new Set(dayData.skipRecurring || []);
            var merged = [];

            (window.userData.planner.recurring || []).forEach(function(rec) {
                if (skipSet.has(rec.id)) return;
                merged.push({
                    id: rec.id,
                    activityId: rec.activityId || null,
                    time: rec.time || '',
                    title: rec.title || '',
                    isRecurring: true,
                    completed: false
                });
            });

            (dayData.items || []).forEach(function(item) {
                merged.push({
                    id: item.id,
                    activityId: item.activityId || null,
                    time: item.time || '',
                    title: item.title || '',
                    isRecurring: false,
                    completed: !!item.completed
                });
            });

            merged.forEach(function(item) {
                if (item.activityId && dateStr === todayStr) {
                    var act = findActivityById(item.activityId);
                    if (act) item.completed = isCompletedToday(act);
                }
            });

            // Sort: timed first (by time), then untimed
            merged.sort(function(a, b) {
                if (a.time && !b.time) return -1;
                if (!a.time && b.time) return 1;
                if (a.time && b.time) return a.time.localeCompare(b.time);
                return 0;
            });

            var container = document.getElementById('plannerTimeline');
            if (!container) return;

            if (merged.length === 0) {
                container.innerHTML = '<div class="planner-empty">'
                    + '<div style="font-size:32px;margin-bottom:10px;">📋</div>'
                    + '<div style="font-size:14px;font-weight:500;color:var(--color-text-primary);margin-bottom:4px;">No items planned</div>'
                    + '<div style="font-size:12px;color:var(--color-text-secondary);">Tap + Add to build your schedule</div>'
                    + '</div>';
                return;
            }

            var isToday = dateStr === todayStr;
            var isPast = dateStr < todayStr;

            // Current time string for today
            var nowTime = '';
            if (isToday) {
                var now = new Date();
                nowTime = (now.getHours() < 10 ? '0' : '') + now.getHours() + ':' + (now.getMinutes() < 10 ? '0' : '') + now.getMinutes();
            }

            var html = '<div class="planner-timeline-wrap">';

            var timedItems = merged.filter(function(i) { return !!i.time; });
            var untimedItems = merged.filter(function(i) { return !i.time; });

            // Group timed items by time slot
            var timeSlots = [];
            var slotMap = {};
            timedItems.forEach(function(item) {
                if (!slotMap[item.time]) {
                    slotMap[item.time] = { time: item.time, items: [] };
                    timeSlots.push(slotMap[item.time]);
                }
                slotMap[item.time].items.push(item);
            });

            var nowInserted = false;

            // Render timed slots as nodes
            timeSlots.forEach(function(slot) {
                // Insert now-marker before this slot if current time is earlier
                if (isToday && !nowInserted && nowTime < slot.time) {
                    html += renderNowMarker(nowTime);
                    nowInserted = true;
                }

                var allDone = slot.items.every(function(i) { return i.completed; });
                var dotClass = 'planner-node-dot' + (allDone ? ' dot-done' : '');

                html += '<div class="planner-node">';
                html += '<div class="' + dotClass + '"></div>';
                html += '<div class="planner-time-label">' + formatTime12(slot.time) + '</div>';
                slot.items.forEach(function(item) {
                    html += renderPlannerCard(item, isToday, isPast);
                });
                html += '</div>';
            });

            // Insert now-marker after all timed items if not yet inserted
            if (isToday && !nowInserted) {
                html += renderNowMarker(nowTime);
            }

            // Untimed section
            if (untimedItems.length > 0) {
                html += '<div class="planner-node">';
                html += '<div class="planner-node-dot dot-note"></div>';
                html += '<div class="planner-anytime-label">Anytime</div>';
                untimedItems.forEach(function(item) {
                    html += renderPlannerCard(item, isToday, isPast);
                });
                html += '</div>';
            }

            html += '</div>'; // close timeline-wrap
            container.innerHTML = html;
        }

        function renderNowMarker(nowTime) {
            return '<div class="planner-now-node">'
                + '<div class="planner-now-dot"></div>'
                + '<div class="planner-now-line"></div>'
                + '<div class="planner-now-label">' + formatTime12(nowTime) + ' — Now</div>'
                + '</div>';
        }

        function renderPlannerCard(item, isToday, isPast) {
            var act = item.activityId ? findActivityById(item.activityId) : null;
            var displayName = act ? act.name : (item.title || 'Untitled');
            var isActivity = !!item.activityId && !!act;
            var dimColor = '';
            if (isActivity) {
                for (var di = 0; di < (window.userData.dimensions || []).length; di++) {
                    var dim = window.userData.dimensions[di];
                    for (var pi = 0; pi < (dim.paths || []).length; pi++) {
                        if ((dim.paths[pi].activities || []).some(function(a) { return a.id === item.activityId; })) {
                            dimColor = DIM_COLOR_MAP[dim.color || 'blue'] || DIM_COLOR_MAP.blue;
                        }
                    }
                }
            }

            var cardClass = 'planner-card';
            if (item.completed) cardClass += ' planner-done';
            if (!isActivity) cardClass += ' planner-note';
            if (isPast && !isToday) cardClass += ' planner-past';

            var clickAction = '';
            if (isActivity && isToday && !item.completed) {
                clickAction = "plannerCompleteActivity('" + item.activityId + "')";
            }

            var undoHtml = '';
            if (isActivity && isToday && item.completed) {
                undoHtml = '<button class="planner-undo" onclick="event.stopPropagation();plannerUndoActivity(\'' + item.activityId + '\')">↩</button>';
            }

            var xpHtml = '';
            if (isActivity && act) {
                xpHtml = '<span class="planner-xp">+' + act.baseXP + ' XP</span>';
            }

            return '<div class="' + cardClass + '"'
                + (dimColor ? ' style="--planner-accent:' + dimColor + ';"' : '')
                + (clickAction ? ' onclick="' + clickAction + '"' : '')
                + '>'
                + (isActivity ? '<div class="planner-card-accent"></div>' : '')
                + '<div class="planner-card-body">'
                + '<div class="planner-card-main">'
                + (item.completed ? '<span class="planner-check-done">✓</span>' : (isActivity && isToday ? '<span class="planner-check-empty"></span>' : ''))
                + '<span class="planner-card-name">' + escapeHtml(displayName) + '</span>'
                + xpHtml
                + undoHtml
                + '</div>'
                + '</div>'
                + '<div class="planner-card-actions">'
                + (item.isRecurring ? '<span class="planner-recurring-badge" title="Repeats daily">↻</span>' : '')
                + '<button class="planner-del-btn" onclick="event.stopPropagation();openPlannerDeleteMenu(\'' + item.id + '\',' + item.isRecurring + ')" title="Remove">✕</button>'
                + '</div>'
                + '</div>';
        }

        // Auto-update now marker every 60 seconds by re-rendering
        setInterval(function() {
            var todayStr = localDateStr();
            if (window._plannerDate === todayStr) {
                var container = document.getElementById('plannerTimeline');
                if (container && container.innerHTML) renderPlanner();
            }
        }, 60000);

        function formatPlannerDate(dateStr) {
            var d = new Date(dateStr + 'T12:00:00');
            var opts = { weekday: 'short', month: 'short', day: 'numeric' };
            return d.toLocaleDateString(undefined, opts);
        }

        function formatTime12(time24) {
            var parts = time24.split(':');
            var h = parseInt(parts[0], 10);
            var m = parts[1] || '00';
            var ampm = h >= 12 ? 'PM' : 'AM';
            h = h % 12 || 12;
            return h + ':' + m + ' ' + ampm;
        }

        function findActivityById(activityId) {
            var dims = (window.userData.dimensions || []);
            for (var di = 0; di < dims.length; di++) {
                var paths = dims[di].paths || [];
                for (var pi = 0; pi < paths.length; pi++) {
                    var acts = paths[pi].activities || [];
                    for (var ai = 0; ai < acts.length; ai++) {
                        if (acts[ai].id === activityId) return acts[ai];
                    }
                }
            }
            return null;
        }

        // ── Complete / Undo from planner ──
        window.plannerCompleteActivity = function(activityId) {
            completeActivityById(activityId);
            // renderPlanner called via updateDashboard -> renderActivitiesList chain
        };

        window.plannerUndoActivity = function(activityId) {
            undoActivityById(activityId);
        };

        // ── Add Modal ──
        var _plannerAddType = 'activity';
        var _plannerSelectedActivityId = null;

        window.openPlannerAddModal = function() {
            _plannerAddType = 'activity';
            _plannerSelectedActivityId = null;
            document.getElementById('plannerAddTime').value = '';
            document.getElementById('plannerAddRecurring').checked = false;
            document.getElementById('plannerActivitySearch').value = '';
            document.getElementById('plannerNoteText').value = '';
            setPlannerAddType('activity');
            populatePlannerActivityList();
            document.getElementById('plannerAddModal').classList.add('active');
        };

        window.closePlannerAddModal = function() {
            document.getElementById('plannerAddModal').classList.remove('active');
        };

        window.setPlannerAddType = function(type) {
            _plannerAddType = type;
            _plannerSelectedActivityId = null;
            document.getElementById('plannerTypeActivity').classList.toggle('active', type === 'activity');
            document.getElementById('plannerTypeNote').classList.toggle('active', type === 'note');
            document.getElementById('plannerActivityPicker').style.display = type === 'activity' ? '' : 'none';
            document.getElementById('plannerNotePicker').style.display = type === 'note' ? '' : 'none';
        };

        function populatePlannerActivityList(filter) {
            var container = document.getElementById('plannerActivityList');
            if (!container) return;
            var searchTerm = (filter || '').toLowerCase();
            var html = '';

            (window.userData.dimensions || []).forEach(function(dim) {
                var dimActivities = [];
                (dim.paths || []).forEach(function(path) {
                    (path.activities || []).forEach(function(act) {
                        if (!searchTerm || act.name.toLowerCase().indexOf(searchTerm) !== -1) {
                            dimActivities.push({ act: act, path: path });
                        }
                    });
                });
                if (dimActivities.length === 0) return;

                var dimColor = DIM_COLOR_MAP[dim.color || 'blue'] || DIM_COLOR_MAP.blue;
                html += '<div class="planner-act-group">';
                html += '<div class="planner-act-dim" style="color:' + dimColor + ';">' + escapeHtml(dim.name) + '</div>';
                dimActivities.forEach(function(da) {
                    var sel = _plannerSelectedActivityId === da.act.id ? ' planner-act-selected' : '';
                    var freq = da.act.frequency || 'daily';
                    var occ = (freq === 'occasional' || freq === 'one-time');
                    var badge = occ ? '<span style="font-size:9px;padding:1px 5px;border-radius:4px;background:rgba(90,159,212,0.12);color:var(--color-accent-blue);margin-left:5px;font-weight:600;">occasional</span>' : '';
                    html += '<div class="planner-act-option' + sel + '" onclick="selectPlannerActivity(\'' + da.act.id + '\')">'
                        + '<span class="planner-act-name">' + escapeHtml(da.act.name) + badge + '</span>'
                        + '<span class="planner-act-xp">+' + da.act.baseXP + ' XP</span>'
                        + '</div>';
                });
                html += '</div>';
            });

            container.innerHTML = html || '<div style="padding:16px;text-align:center;color:var(--color-text-secondary);font-size:12px;">No activities found</div>';
        }

        window.filterPlannerActivities = function() {
            var term = document.getElementById('plannerActivitySearch').value;
            populatePlannerActivityList(term);
        };

        window.selectPlannerActivity = function(actId) {
            _plannerSelectedActivityId = actId;
            populatePlannerActivityList(document.getElementById('plannerActivitySearch').value);
        };

        window.savePlannerItem = async function() {
            ensurePlannerData();
            var time = document.getElementById('plannerAddTime').value || '';
            var isRecurring = document.getElementById('plannerAddRecurring').checked;
            var itemId = 'pl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

            if (_plannerAddType === 'activity') {
                if (!_plannerSelectedActivityId) {
                    alert('Please select an activity.');
                    return;
                }
                var entry = { id: itemId, activityId: _plannerSelectedActivityId, time: time, title: '' };
                if (isRecurring) {
                    window.userData.planner.recurring.push(entry);
                } else {
                    getPlannerDay(window._plannerDate).items.push(entry);
                }
            } else {
                var noteText = (document.getElementById('plannerNoteText').value || '').trim();
                if (!noteText) {
                    alert('Please enter a note.');
                    return;
                }
                var entry = { id: itemId, activityId: null, time: time, title: noteText };
                if (isRecurring) {
                    window.userData.planner.recurring.push(entry);
                } else {
                    getPlannerDay(window._plannerDate).items.push(entry);
                }
            }

            await saveUserData();
            closePlannerAddModal();
            renderPlanner();
        };

        // ── Delete planner item — 3-choice action sheet ──
        window.openPlannerDeleteMenu = function(itemId, isRecurring) {
            // Build action sheet overlay
            var existing = document.getElementById('plannerDeleteSheet');
            if (existing) existing.remove();

            var sheet = document.createElement('div');
            sheet.id = 'plannerDeleteSheet';
            sheet.className = 'planner-action-sheet-overlay';
            sheet.onclick = function(e) { if (e.target === sheet) sheet.remove(); };

            var menu = '<div class="planner-action-sheet">'
                + '<div class="planner-action-title">Remove this item?</div>';

            if (isRecurring) {
                menu += '<button class="planner-action-btn planner-action-warn" onclick="executePlannerDelete(\'' + itemId + '\',\'today\')">Remove for today only</button>';
                menu += '<button class="planner-action-btn planner-action-danger" onclick="executePlannerDelete(\'' + itemId + '\',\'permanent\')">Delete permanently</button>';
            } else {
                menu += '<button class="planner-action-btn planner-action-danger" onclick="executePlannerDelete(\'' + itemId + '\',\'delete\')">Delete</button>';
            }

            menu += '<button class="planner-action-btn planner-action-cancel" onclick="document.getElementById(\'plannerDeleteSheet\').remove()">Cancel</button>';
            menu += '</div>';

            sheet.innerHTML = menu;
            document.body.appendChild(sheet);
        };

        window.executePlannerDelete = async function(itemId, action) {
            ensurePlannerData();
            if (action === 'today') {
                var day = getPlannerDay(window._plannerDate);
                if (!day.skipRecurring) day.skipRecurring = [];
                day.skipRecurring.push(itemId);
            } else if (action === 'permanent') {
                window.userData.planner.recurring = window.userData.planner.recurring.filter(function(r) { return r.id !== itemId; });
            } else {
                var day = getPlannerDay(window._plannerDate);
                day.items = (day.items || []).filter(function(i) { return i.id !== itemId; });
            }
            var sheet = document.getElementById('plannerDeleteSheet');
            if (sheet) sheet.remove();
            await saveUserData();
            renderPlanner();
        };

        // ── Inline planner toggle ─────────────────────────────────────────
        // Planner now opens inline within the My Activities sub-tab,
        // replacing the activity list area below the action toolbar.
        // We use explicit 'block' / 'none' rather than '' so the state
        // machine is unambiguous on the second tap.
        window.togglePlannerInline = function() {
            var listEl    = document.getElementById('activitiesListContainer');
            var plannerEl = document.getElementById('activitiesInlinePlanner');
            var btnEl     = document.getElementById('plannerBtn');
            if (!listEl || !plannerEl) return;
            var isOpen = plannerEl.style.display === 'block';
            if (!isOpen) {
                listEl.style.display = 'none';
                plannerEl.style.display = 'block';
                if (btnEl) btnEl.classList.add('active');
                if (typeof renderPlanner === 'function') renderPlanner();
            } else {
                plannerEl.style.display = 'none';
                listEl.style.display = 'block';
                if (btnEl) btnEl.classList.remove('active');
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
            updateRestoreBackupBtn();
            // Populate "signed in as" label with username + email
            const seEl = document.getElementById('settingsEmail');
            if (seEl && window.currentUser) {
                const prof = window.userData && window.userData.profile;
                const name = (prof && prof.username) || window.currentUser.displayName || '';
                const email = window.currentUser.email || '';
                seEl.textContent = name ? name + '  ·  ' + email : email;
            }
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
            // Always deep-copy so we don't mutate _pendingTheme while saving
            var pending = JSON.parse(JSON.stringify(window._pendingTheme || {}));
            if (pending.presetId === 'custom') {
                CUSTOM_COLOR_VARS.forEach(function(v) {
                    var el = document.getElementById('cp_' + v.id);
                    if (el) pending['custom_' + v.id] = el.value;
                });
                if (document.getElementById('cp_accent'))    pending.accent    = document.getElementById('cp_accent').value;
                if (document.getElementById('cp_progress'))  pending.progress  = document.getElementById('cp_progress').value;
                if (document.getElementById('cp_bg'))        pending.bg        = document.getElementById('cp_bg').value;
                if (document.getElementById('cp_card'))      pending.card      = document.getElementById('cp_card').value;
                if (document.getElementById('cp_secondary')) pending.secondary = document.getElementById('cp_secondary').value;
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
            window._pendingTheme = pending;
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
            // Reset ALL custom vars to defaults first so no values bleed from a previously-applied slot
            CUSTOM_COLOR_VARS.forEach(function(v) {
                document.documentElement.style.setProperty(v.variable, v.default);
            });
            // Apply this slot's values
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
            var freshCopy = JSON.parse(JSON.stringify(slot));
            freshCopy.presetId = 'custom';
            window._pendingTheme = freshCopy;
            buildColorGrid();
            buildGradientPresets();
            _restoreGlowSliders(slot);
            // Mark the custom swatch active
            document.querySelectorAll('.theme-swatch').forEach(function(s){ s.classList.remove('active'); });
            var csw = document.getElementById('customSwatch');
            if (csw) csw.classList.add('active');
            // Auto-save immediately so it survives reload
            if (!window.userData.settings) window.userData.settings = {};
            window.userData.settings.theme = freshCopy;
            saveUserData();
            showToast('🎨 Theme applied!', 'blue');
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

        // ══════════════════════════════════════════════════════════════════
        // ── processStreakSystem ───────────────────────────────────────────
        // THE single authoritative write path for streak + shields.
        // Called once per day per activity at login via processStreakPauses().
        // Idempotent: skips if lastProcessedDate === today.
        //
        // ALGORITHM — walk backwards through closed cycle-windows:
        //   Hit  → streak++
        //   Miss → if shieldsLeft > 0: consume one shield and continue
        //          else: break (unshielded miss = streak is over)
        //
        // "Closed" means the window ended before today's window started.
        // Today's open window is handled exclusively by completeActivity
        // (streak +1 via streakGrantedDate guard). Undo reverses that +1.
        //
        // SHIELD RULES:
        //   3 shields per streak. Each missed closed window costs 1 shield.
        //   Streak survives up to 3 total misses; 4th unshielded miss ends it.
        //   Shields reset to 3 automatically when a new streak begins — the
        //   walk finds no consumed shields in a fresh run → shieldsConsumed = 0.
        //   completeActivity and undoActivity NEVER touch shieldsConsumed.
        //
        // MIGRATION SAFETY (first run only):
        //   If the walk returns streak=0 but stored streak>0 exists, the user
        //   may have sparse legacy history. We trust stored values this one time.
        //   From the next day onwards the walk is fully authoritative.
        //
        // Returns true if any field was mutated (caller saves to Firestore).
        // ══════════════════════════════════════════════════════════════════
        function processStreakSystem(activity, today) {
            // No streak mechanics for these types
            if (activity.frequency === 'occasional') return false;
            if (activity.isNegative && !activity.isSkipNegative) return false;

            // Idempotency: only run once per calendar day per activity
            if (activity.lastProcessedDate === today) return false;
            const isFirstRun = !activity.lastProcessedDate;
            activity.lastProcessedDate = today;

            // Remove legacy fields from the in-memory object. Using delete ensures
            // they are omitted on the next setDoc write regardless of SDK behavior.
            delete activity.streakShieldWindow;
            delete activity.lastShieldCheckDate;
            delete activity.streakPaused;

            // Nothing to compute yet
            if (!activity.lastCompleted) return true;

            // ── Real completions only (no XP-penalty entries) ────────────
            const history = (activity.completionHistory || []).filter(
                e => !e.isPenalty && (e.xp || 0) > 0
            );

            // ── Most recently closed window ──────────────────────────────
            const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
            const todayWindow = getCycleWindowStart(activity, todayMidnight);
            if (!todayWindow) return true;

            // Window immediately before today's = most recently closed
            let cursor = getCycleWindowStart(activity, new Date(todayWindow.getTime() - 1));
            if (!cursor) return true;

            // ── Walk floor: stop at whichever boundary is more recent ─────
            //
            // Floor A — activity creation:
            //   Use the WINDOW START containing createdAt, not createdAt itself.
            //   For non-daily frequencies (weekly/biweekly/monthly/custom), the
            //   activity may be created mid-cycle. Comparing cursor directly to
            //   createdAt would stop the walk before processing the first cycle
            //   window, causing the first week/month of completions to be missed.
            const actCreated = new Date(activity.createdAt || (history[0] ? history[0].date : todayMidnight));
            actCreated.setHours(0, 0, 0, 0);
            const actCreatedWindow = getCycleWindowStart(activity, actCreated) || actCreated;

            // Floor B — oldest history entry:
            //   completionHistory is capped at 365 entries. For activities older
            //   than 365 days, windows beyond the oldest entry have no data — we
            //   cannot distinguish a genuine miss from a pruned entry. Stop here
            //   to avoid falsely consuming shields for pre-history gaps.
            const oldestEntry = history.length > 0
                ? history.reduce((a, b) => new Date(a.date) < new Date(b.date) ? a : b)
                : null;
            const historyFloorWindow = oldestEntry
                ? (getCycleWindowStart(activity, new Date(oldestEntry.date)) || actCreatedWindow)
                : actCreatedWindow;

            // Use whichever floor is more recent (further restricts the walk)
            // Floor C — streak-start anchor: prevents the walk from crossing a previous
            // streak break. Without this, the walk bridges the gap (N missed days between
            // old streak and new streak) using shields, consuming all 3 on the gap and
            // leaving the fresh streak with 0 shields. streakStartWindow is stamped by
            // completeActivity on every 0→1 streak transition.
            const streakStartDate = activity.streakStartWindow
                ? new Date(activity.streakStartWindow + 'T00:00:00')
                : null;
            const streakStartFloor = streakStartDate
                ? (getCycleWindowStart(activity, streakStartDate) || streakStartDate)
                : null;
            const walkFloor = [historyFloorWindow, actCreatedWindow, streakStartFloor]
                .filter(Boolean)
                .reduce((a, b) => a > b ? a : b);

            // ── Backwards walk ───────────────────────────────────────────
            // Sort history by date ascending once so each window check scans
            // from the most likely match forward — avoids O(H×W) in the worst
            // case. In practice H≤365, W≤365: either way is sub-millisecond,
            // but this is cleaner and future-proof.
            const sortedHistory = history.slice().sort((a, b) => new Date(a.date) - new Date(b.date));

            let streak = 0;
            let shieldsConsumed = 0;
            let walkCapUsed = BASE_SHIELDS; // shield cap re-derived by walk
            const MAX_WALK = 400;

            if (streakStartFloor) {
                // ── Forward walk (chronologically correct) ───────────────────
                // Walk from streakStartWindow → today, oldest window first.
                // Shields are consumed in the order misses actually occurred, which
                // matches the user's mental model: "I missed day 3 so a shield was
                // used; I missed day 8 so the streak broke."
                //
                // The backward walk had a critical flaw: it allocated shields to
                // the most RECENT misses first. A pattern like:
                //   [hit, miss, miss, hit, hit, miss, miss, miss]   (forward time)
                // Walking backward: miss×3 → use 3 shields → find hit×2 → miss
                // → no shields → stop. Result: streak=2 (wrong).
                // Walking forward: hit → miss×2 (shield×2) → hit×2 → miss×3
                // → use shield 3 on first → unshielded miss → BREAK. Result: streak=0 (correct).
                let fwdCursor = streakStartFloor;
                for (let i = 0; i < MAX_WALK; i++) {
                    if (!fwdCursor || fwdCursor.getTime() >= todayWindow.getTime()) break;
                    const nextWin = getNextCycleWindowStart(activity, fwdCursor);
                    if (!nextWin) break;
                    const cStart = fwdCursor.getTime(), cEnd = nextWin.getTime();
                    const hit = sortedHistory.some(e => {
                        const t = new Date(e.date).getTime();
                        return t >= cStart && t < cEnd;
                    });
                    if (hit) {
                        streak++;
                        // Milestone bonus: +1 shield added to balance when streak
                        // crosses 25/50/75/100, exactly as completeActivity does live.
                        if (SHIELD_MILESTONES.includes(streak))
                            walkCapUsed = Math.min(SHIELD_ABS_CAP, walkCapUsed + 1);
                    } else if (streak > 0 && (walkCapUsed - shieldsConsumed) > 0) {
                        shieldsConsumed++;
                    } else if (streak > 0) {
                        // Unshielded miss — streak breaks.
                        // Reset for any new streak segment that may start later.
                        streak = 0; shieldsConsumed = 0; walkCapUsed = BASE_SHIELDS;
                    }
                    // streak===0 + miss: no active streak to protect, skip.
                    fwdCursor = nextWin;
                }
            } else {
                // ── Backward walk (fallback: no streakStartWindow set) ────────
                // Only reached for activities that pre-date the streakStartWindow
                // field and haven't completed since. New streaks always set
                // streakStartWindow via completeActivity, so this path is rare.
                let shieldsLeft = BASE_SHIELDS;
                let hitFloor = false;
                for (let i = 0; i < MAX_WALK; i++) {
                    if (!cursor || cursor < walkFloor) { hitFloor = true; break; }
                    const nextWindowStart = getNextCycleWindowStart(activity, cursor);
                    if (!nextWindowStart) { hitFloor = true; break; }
                    const cStart = cursor.getTime(), cEnd = nextWindowStart.getTime();
                    const hit = sortedHistory.some(e => {
                        const t = new Date(e.date).getTime();
                        return t >= cStart && t < cEnd;
                    });
                    if (hit) { streak++; }
                    else if (shieldsLeft > 0) { shieldsConsumed++; shieldsLeft--; }
                    else { break; }
                    cursor = getCycleWindowStart(activity, new Date(cursor.getTime() - 1));
                }
                // History-floor extension: trust stored streak for pre-history portion
                // if the visible run was perfectly clean (no shield use, no break).
                const _stored = activity.streak || 0;
                if (hitFloor && streak > 0 && shieldsConsumed === 0 && _stored > streak)
                    streak = _stored;
                walkCapUsed = Math.min(SHIELD_ABS_CAP,
                    BASE_SHIELDS + SHIELD_MILESTONES.filter(m => streak >= m).length);
            }

            const finalStreak = streak;

            // ── Migration safety net (first run only, walk returned 0) ────
            if (isFirstRun && streak === 0 && (activity.streak || 0) > 0) {
                activity.shieldsConsumed = Math.min(BASE_SHIELDS, activity.streakPauseUses || 0);
                return true;
            }

            // ── Open-window protection for non-daily frequencies ─────────
            // The walk only checks CLOSED windows. For weekly/biweekly/monthly
            // activities the current open window can last 7–30 days. If the user
            // completed in THIS week/month and processStreakSystem fires on a
            // subsequent day within the same window, the walk's cursor starts at
            // the PREVIOUS closed window (already below streakStartFloor) and
            // immediately hits the floor with streak=0 — wiping a valid streak
            // and clearing streakStartWindow, which then causes shields to be
            // burned across the gap on the NEXT open-window day.
            //
            // Guard: if the walk returned 0 but the stored streak is positive and
            // streakStartWindow sits inside the CURRENT open window, the walk had
            // nothing to verify yet — completeActivity already owns this window.
            // Leave streak and streakStartWindow untouched.
            if (finalStreak === 0 && (activity.streak || 0) > 0 && activity.streakStartWindow) {
                const swDate = new Date(activity.streakStartWindow + 'T00:00:00');
                const swWindow = getCycleWindowStart(activity, swDate);
                if (swWindow && todayWindow && swWindow.getTime() === todayWindow.getTime()) {
                    // Streak started in the current open window — nothing to adjudicate yet.
                    return true;
                }
            }

            // ── Write authoritative values ────────────────────────────────
            activity.streak          = finalStreak;
            activity.shieldsConsumed = finalStreak > 0 ? shieldsConsumed : 0;
            activity.bestStreak      = Math.max(activity.bestStreak || 0, finalStreak);
            if (finalStreak === 0) {
                activity.streakStartWindow = null;
                activity.shieldCapUsed     = BASE_SHIELDS;
            } else {
                activity.shieldCapUsed = walkCapUsed;
            }

            // Remove legacy field
            delete activity.streakPauseUses;

            return true;
        }

        // ── migrateStreakStartWindows ─────────────────────────────────────
        // ONE-TIME migration (v69). Fixes users hit by the shield-gap bug where
        // the backward walk crossed a previous streak break using shields, leaving
        // active streaks with shieldsConsumed=3 / "0 shields left".
        //
        // For every activity that has an active streak but no streakStartWindow
        // (pre-v69), we:
        //   1. Reset shieldsConsumed to 0  — benefit of the doubt; consumed shields
        //      were almost certainly gap-bug artefacts, not real in-streak misses.
        //   2. Stamp streakStartWindow so the walk floor is correct from today.
        //
        // Guard: streakShieldsMigrated=true is written per-activity so this is
        // idempotent across multiple logins.
        function migrateStreakStartWindows() {
            let changed = false;

            // ── V1 migration (already ran for most users, kept for new installs) ──
            (window.userData.dimensions || []).forEach(dim =>
                (dim.paths || []).forEach(path =>
                    (path.activities || []).forEach(act => {
                        if (act.streakShieldsMigrated) return;
                        act.streakShieldsMigrated = true;
                        changed = true;
                        // V2 will handle the real healing; V1 just stamps the guard.
                    })));

            // ── V2 migration (v74) — walk history to find actual streak start ──
            // All previous versions set the floor wrong:
            //  V1-V4: used stored streak count (which mid-week wipe had zeroed → 0+3=3 back, too loose)
            //  V5:    used lastCompleted's window (correct for streak=1, but too recent
            //         for streak>1 with shields used — walk found only 1 hit, shieldsConsumed>0,
            //         storedStreak extension didn't fire, streak reduced to 1)
            //
            // The correct approach mirrors the daily fix exactly:
            // Walk history BACKWARDS from lastCompleted, using shields for missed windows,
            // until hitting an unshielded break. The oldest hit found = streak start.
            // This is fully frequency-agnostic (uses getCycleWindowStart/getNextCycleWindowStart)
            // and works identically for daily/weekly/biweekly/monthly/custom activities.
            //
            // After the migration, processStreakSystem re-runs with the correct floor and
            // recomputes shieldsConsumed from real misses within the current streak.
            (window.userData.dimensions || []).forEach(dim =>
                (dim.paths || []).forEach(path =>
                    (path.activities || []).forEach(act => {
                        if (act.streakShieldsMigratedV6) return;
                        act.streakShieldsMigratedV6 = true;
                        changed = true;

                        if (act.frequency === 'occasional') return;
                        if (act.isNegative && !act.isSkipNegative) return;
                        if (!act.lastCompleted) return;

                        // Real completions only (mirrors processStreakSystem's filter)
                        const migHist = (act.completionHistory || []).filter(
                            e => !e.isPenalty && (e.xp || 0) > 0
                        );

                        // Walk backwards from lastCompleted's window, shields for misses.
                        // streakStart tracks the oldest hit found in the current run.
                        const migLC = new Date(act.lastCompleted);
                        let migCursor = getCycleWindowStart(act, migLC);
                        if (!migCursor) { act.shieldsConsumed = 0; act.lastProcessedDate = null; return; }

                        let migShieldsLeft = BASE_SHIELDS;
                        let streakStart = migCursor; // will be updated to oldest hit found
                        const MAX_MIG_WALK = 400;

                        for (let i = 0; i < MAX_MIG_WALK; i++) {
                            const migWinEnd = getNextCycleWindowStart(act, migCursor);
                            if (!migWinEnd) break;

                            const mws = migCursor.getTime();
                            const mwe = migWinEnd.getTime();
                            const migHit = migHist.some(e => {
                                const t = new Date(e.date).getTime();
                                return t >= mws && t < mwe;
                            });

                            if (migHit) {
                                streakStart = migCursor; // extend start to this older hit
                            } else if (migShieldsLeft > 0) {
                                migShieldsLeft--;         // shield covers this miss
                            } else {
                                break;                    // unshielded miss — streak started after this
                            }

                            const prev = getCycleWindowStart(act, new Date(migCursor.getTime() - 1));
                            if (!prev) break;
                            migCursor = prev;
                        }

                        act.streakStartWindow  = toLocalDateStr(streakStart);
                        act.shieldsConsumed    = 0; // processStreakSystem recomputes from real misses
                        act.lastProcessedDate  = null; // force re-run this login with correct floor
                    })));

            return changed;
        }

        // ── processStreakPauses ───────────────────────────────────────────
        // Entry point called at login. Runs streak+shield system and XP
        // penalties for all activities, then persists any changes in one write.
        async function processStreakPauses() {
            const today = toLocalDateStr(new Date());
            let anyChanged = false;
            // One-time shield migration must run before processStreakSystem so the
            // correct shieldsConsumed=0 and streakStartWindow floor are in place
            // before the walk sees this activity for the first time today.
            if (migrateStreakStartWindows()) anyChanged = true;
            (window.userData.dimensions || []).forEach(dim =>
                (dim.paths || []).forEach(path =>
                    (path.activities || []).forEach(act => {
                        if (processStreakSystem(act, today)) anyChanged = true;
                        if (processSkipPenalty(act, today))  anyChanged = true;
                    })));
            if (anyChanged) {
                try { await saveUserData(); } catch(e) { console.warn('processStreakPauses save failed', e); }
            }
        }

        // ── toLocalDateStr ─────────────────────────────────────────────
        // Returns a YYYY-MM-DD string in LOCAL time, not UTC.
        // Critical for lastAccountedWindow: window boundaries are local midnight,
        // so storing the UTC date (toISOString().slice(0,10)) is wrong in any
        // timezone east of UTC — local midnight is UTC previous day there.
        function toLocalDateStr(d) {
            const y  = d.getFullYear();
            const mo = String(d.getMonth() + 1).padStart(2, '0');
            const dy = String(d.getDate()).padStart(2, '0');
            return y + '-' + mo + '-' + dy;
        }

        // ── localToday / localYesterday ────────────────────────────────
        // Single authoritative source for "what date is it right now"
        // in the user's own timezone. Always use these instead of
        // new Date().toISOString().split('T')[0], which returns UTC and
        // is wrong for any user east of UTC (e.g. IST is UTC+5:30, so
        // UTC midnight is 5:30 AM local — the user's "today" would show
        // as "yesterday" on the leaderboard for the first 5.5 hours).
        function localToday() {
            return toLocalDateStr(new Date());
        }

        // Yesterday in local time. Used by computeXPPerHour.
        function localYesterday() {
            const d = new Date();
            d.setDate(d.getDate() - 1);
            return toLocalDateStr(d);
        }

        // ── getCycleWindowStart ───────────────────────────────────────
        // Returns the local-midnight start of the cycle window containing dateObj.
        // Mirrors isCompletedToday() window definitions exactly so penalty logic
        // and completion logic always agree on boundaries.
        // Returns null for occasional (no penalty windows).
        function getCycleWindowStart(activity, dateObj) {
            const freq = activity.frequency || 'daily';
            const d = new Date(dateObj);
            d.setHours(0, 0, 0, 0);

            if (freq === 'daily') {
                return new Date(d);
            }
            if (freq === 'weekly') {
                // Sunday-anchored week (matches isCompletedToday)
                const dow = d.getDay(); // 0 = Sun
                const sun = new Date(d);
                sun.setDate(d.getDate() - dow);
                return sun;
            }
            if (freq === 'biweekly') {
                // Anchored to Jan 5 2025 (matches isCompletedToday)
                const biAnchor = new Date('2025-01-05T00:00:00');
                const weeksSinceAnchor = Math.floor((d - biAnchor) / (7 * 86400000));
                const cycleWeek = weeksSinceAnchor - (weeksSinceAnchor % 2);
                return new Date(biAnchor.getTime() + cycleWeek * 7 * 86400000);
            }
            if (freq === 'monthly') {
                return new Date(d.getFullYear(), d.getMonth(), 1);
            }
            if (freq === 'custom') {
                if (activity.customSubtype === 'days') {
                    // Weekly window: Monday-anchored (penalty once per week)
                    const dow2 = d.getDay(); // 0 = Sun
                    const mon = new Date(d);
                    mon.setDate(d.getDate() - ((dow2 + 6) % 7));
                    return mon;
                } else {
                    // Rolling N-day cycle anchored to createdAt
                    const cycleDays = activity.customDays || 1;
                    const origin = new Date(activity.createdAt || dateObj);
                    origin.setHours(0, 0, 0, 0);
                    const daysSinceOrigin = Math.floor((d - origin) / 86400000);
                    const cycleNum = Math.floor(daysSinceOrigin / cycleDays);
                    const start = new Date(origin);
                    start.setDate(origin.getDate() + cycleNum * cycleDays);
                    return start;
                }
            }
            return null; // occasional / unknown
        }

        // ── getNextCycleWindowStart ────────────────────────────────
        // Returns the start of the window immediately after the one containing dateObj.
        // Pure date arithmetic, no I/O.
        function getNextCycleWindowStart(activity, dateObj) {
            const freq = activity.frequency || 'daily';
            const current = getCycleWindowStart(activity, dateObj);
            if (!current) return null;
            if (freq === 'daily') {
                const n = new Date(current); n.setDate(current.getDate() + 1); return n;
            }
            if (freq === 'weekly') {
                const n = new Date(current); n.setDate(current.getDate() + 7); return n;
            }
            if (freq === 'biweekly') {
                const n = new Date(current); n.setDate(current.getDate() + 14); return n;
            }
            if (freq === 'monthly') {
                return new Date(current.getFullYear(), current.getMonth() + 1, 1);
            }
            if (freq === 'custom') {
                if (activity.customSubtype === 'days') {
                    const n = new Date(current); n.setDate(current.getDate() + 7); return n;
                } else {
                    const cd = activity.customDays || 1;
                    const n = new Date(current); n.setDate(current.getDate() + cd); return n;
                }
            }
            return null;
        }

        // ── wasCompletedInWindow ───────────────────────────────────
        // Returns true if there is at least one positive-XP user-initiated completion
        // anywhere in [windowStart, windowEnd). Penalties (isPenalty:true) are excluded.
        function wasCompletedInWindow(activity, windowStart, windowEnd) {
            const s = windowStart.getTime();
            const e = windowEnd.getTime();
            if (activity.completionHistory && activity.completionHistory.length > 0) {
                return activity.completionHistory.some(entry => {
                    if (entry.isPenalty || (entry.xp || 0) <= 0) return false;
                    const t = new Date(entry.date).getTime();
                    return t >= s && t < e;
                });
            }
            // Legacy fallback: only lastCompleted available
            if (activity.lastCompleted) {
                const t = new Date(activity.lastCompleted).getTime();
                return t >= s && t < e;
            }
            return false;
        }

        // ── processSkipPenalty ────────────────────────────────────────────
        // Applies XP penalties for skip-negative activities.
        // Uses skipPenaltyWindow stamp to count only NEW missed windows each login.
        // Idempotent per day via lastSkipCheckDate.
        // Returns true if data changed (caller must save).
        function processSkipPenalty(activity, today) {
            if (!activity.isSkipNegative) return false;
            if (activity.lastSkipCheckDate === today) return false;
            const freq = activity.frequency || 'daily';
            if (freq === 'occasional') {
                activity.lastSkipCheckDate = today;
                return false;
            }
            if (!activity.lastCompleted) {
                activity.lastSkipCheckDate = today;
                return true;
            }

            // IMPORTANT: read the penalty window BEFORE stamping lastSkipCheckDate,
            // because _getSkipPenaltyWindow falls back to lastSkipCheckDate for
            // legacy activities that don't have skipPenaltyWindow yet. Stamping
            // first would make the fallback resolve to today → 0 missed windows.
            const penaltyWin = _getSkipPenaltyWindow(activity);
            activity.lastSkipCheckDate = today;
            if (!penaltyWin) {
                // No anchor — stamp current window and exit
                activity.skipPenaltyWindow = toLocalDateStr(
                    getCycleWindowStart(activity, new Date()) || new Date()
                );
                return true;
            }

            const { count: newMissed, lastWindowDateStr } = _missedWindowsSince(activity, penaltyWin, 7);

            // Advance stamp regardless of penalty (prevents double-counting next login)
            if (lastWindowDateStr && lastWindowDateStr !== penaltyWin) {
                activity.skipPenaltyWindow = lastWindowDateStr;
            }

            if (newMissed === 0) return true;

            const missedCapped = Math.min(7, newMissed);
            activity.skipStreak = (activity.skipStreak || 0) + missedCapped;

            // 1 baseXP penalty per missed window — flat, no compounding
            const penaltyPerWindow = activity.baseXP || 10;
            const totalPenalty = penaltyPerWindow * missedCapped;
            window.userData.currentXP -= totalPenalty;
            window.userData.totalXP   -= totalPenalty;
            while (window.userData.currentXP < 0 && window.userData.level > 1) {
                window.userData.level     -= 1;
                window.userData.currentXP += calculateXPForLevel(window.userData.level);
            }
            if (window.userData.currentXP < 0) window.userData.currentXP = 0;

            recordCompletion(activity, -totalPenalty, true);
            const _penDim = findDimForActivity(activity.id);
            if (_penDim) applyDimXP(_penDim, -totalPenalty);

            activity.lastPenaltyDate = today;
            activity.lastPenaltyDays = missedCapped;
            return true;
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
            const btn = document.getElementById('restoreBackupBtn');
            if (btn) btn.disabled = true;
            // Start with whatever is in memory — works offline
            let backup = window.userData && window.userData.autoBackup;
            try {
                // Optionally refresh from Firestore if online
                const userDocRef = doc(db, 'users', window.currentUser.uid);
                const snap = await getDoc(userDocRef);
                if (snap.exists() && snap.data().autoBackup) {
                    backup = snap.data().autoBackup;
                }
            } catch (netErr) {
                console.warn('Could not fetch fresh backup (offline?), using cached:', netErr.message);
            }
            try {
                if (!backup || !backup.data) {
                    showToast('No backup found yet. Complete any activity to auto-create one.', 'red');
                    return;
                }
                const savedDate = backup.savedDate || '';
                const when = backup.savedAt ? new Date(backup.savedAt).toLocaleString() : savedDate;
                if (!confirm('Restore backup from ' + when + '?\n\nThis replaces ALL current data.\nYour current state will be lost.\n\nContinue?')) return;
                window.userData = backup.data;
                if (!window.userData.settings) window.userData.settings = {};
                processStreakPauses();
                _backupSavedDate = null;
                await saveUserData();
                loadSettings();
                updateDashboard();
                showToast('🔄 Restored from ' + (savedDate || when), 'olive');
            } catch(e) {
                console.error('Restore error:', e);
                alert('Restore failed: ' + e.message);
            } finally {
                if (btn) btn.disabled = false;
            }
        };

        // Manually trigger an immediate backup
        window.backupNow = async function() {
            if (!window.currentUser) return;
            const btn = document.getElementById('backupNowBtn');
            if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
            try {
                _backupSavedDate = null;
                await saveUserData();
                showToast('✅ Backup saved!', 'green');
            } catch(e) {
                showToast('Backup failed: ' + e.message, 'red');
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = 'Backup Now'; }
            }
        };
        // ── Import / Export / Reset ───────────────────────────────────────

        window.exportData = function() {
            const blob = new Blob([JSON.stringify(window.userData, null, 2)], { type: 'application/json' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = `levelup-backup-${localToday()}.json`;
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

        // ── Profile Overlay ───────────────────────────────────────────────

        // Update the header avatar chip
        function updateProfileAvatar() {
            if (!window.currentUser) return;
            const imgEl    = document.getElementById('profileAvatarImg');
            const initEl   = document.getElementById('profileAvatarInitial');
            const photoURL = window.currentUser.photoURL;
            const name     = (window.userData && window.userData.profile && window.userData.profile.username)
                             || window.currentUser.displayName || 'U';
            if (photoURL && imgEl) {
                imgEl.src = photoURL;
                imgEl.style.display = 'block';
                if (initEl) initEl.style.display = 'none';
            } else if (initEl) {
                imgEl.style.display = 'none';
                initEl.style.display = '';
                initEl.textContent = (name[0] || '?').toUpperCase();
            }
        }

        window.openProfileOverlay = function() {
            document.getElementById('profileOverlay').style.display = 'block';
            document.body.style.overflow = 'hidden';
            renderProfileOverlay();
        };

        window.closeProfileOverlay = function() {
            document.getElementById('profileOverlay').style.display = 'none';
            document.body.style.overflow = '';
        };

        function renderProfileOverlay() {
            if (!window.userData || !window.currentUser) return;
            const data = window.userData;
            const profile = data.profile || {};
            const user = window.currentUser;

            // ── Avatar (large) ────────────────────────────────────────────
            const largeAvatar = document.getElementById('profileLargeAvatar');
            if (largeAvatar) {
                const username = profile.username || user.displayName || 'U';
                if (user.photoURL) {
                    largeAvatar.innerHTML = `<img src="${escapeHtml(user.photoURL)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="">`;
                } else {
                    largeAvatar.style.background = 'linear-gradient(135deg,var(--color-accent-blue),var(--color-progress))';
                    largeAvatar.textContent = (username[0] || '?').toUpperCase();
                    largeAvatar.style.color = '#fff';
                }
            }

            // ── Character title ────────────────────────────────────────────
            const catXP = getProfileCategoryXP();
            const title = getCharacterTitle(data.level || 1, catXP);
            const titleEl = document.getElementById('profileCharTitle');
            if (titleEl) titleEl.textContent = title;

            // ── Username ──────────────────────────────────────────────────
            const displayName = profile.username || user.displayName || user.email || 'Adventurer';
            const usernameText = document.getElementById('profileUsernameText');
            if (usernameText) usernameText.textContent = displayName;

            // ── Member since ──────────────────────────────────────────────
            const sinceEl = document.getElementById('profileMemberSince');
            if (sinceEl && data.createdAt) {
                const since = new Date(data.createdAt);
                const now = new Date();
                const diffDays = Math.floor((now - since) / (1000 * 60 * 60 * 24));
                const diffMonths = Math.floor(diffDays / 30);
                const tenure = diffMonths >= 2
                    ? `${diffMonths} months in`
                    : diffDays >= 2
                        ? `${diffDays} days in`
                        : 'Day 1';
                sinceEl.textContent = `Member since ${since.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} · ${tenure}`;
            }

            // ── Level bar — header-matching style ─────────────────────────
            const level = data.level || 1;
            const isMax = level >= 100;
            const xpNeeded = isMax ? 0 : calculateXPForLevel(level);
            const xpCurrent = data.currentXP || 0;
            const pct = isMax ? 100 : xpNeeded > 0 ? Math.min(100, (xpCurrent / xpNeeded) * 100) : 0;

            const xpCurrentEl  = document.getElementById('profileXpCurrent');
            const progressPct  = document.getElementById('profileProgressPct');
            const xpToNext     = document.getElementById('profileXpToNext');
            const levelBar     = document.getElementById('profileLevelBar');
            const levelLbl     = document.getElementById('profileLevelLabel');
            const xpLbl        = document.getElementById('profileXpLabel');

            if (xpCurrentEl) xpCurrentEl.textContent = isMax ? 'MAX' : xpCurrent.toLocaleString();
            if (progressPct) progressPct.textContent  = isMax ? '100%' : Math.floor(pct) + '%';
            if (xpToNext)    xpToNext.textContent     = isMax ? 'Max level!' : `${Math.max(0, xpNeeded - xpCurrent).toLocaleString()} XP to next`;
            if (levelBar)    levelBar.style.width      = pct.toFixed(1) + '%';
            if (levelLbl)    levelLbl.textContent      = `Level ${level}${isMax ? ' · MAX' : ''}`;
            if (xpLbl)       xpLbl.textContent         = isMax ? '' : `${xpCurrent.toLocaleString()} / ${xpNeeded.toLocaleString()} XP`;

            // ── Stats grid ────────────────────────────────────────────────
            const allActs = [];
            (data.dimensions || []).forEach(dim =>
                (dim.paths || []).forEach(path =>
                    (path.activities || []).forEach(act => allActs.push(act))));

            const totalXP      = (data.totalXP || 0) + (data.xpDeletedGhost || 0);
            const totalComps   = allActs.reduce((s, a) => s + (a.completionCount || 0), 0);
            const bestStreak   = allActs.reduce((m, a) => Math.max(m, a.bestStreak || a.streak || 0), 0);
            const dimCount     = (data.dimensions || []).length;
            const actCount     = allActs.length;

            // Unique active days
            const daySet = new Set();
            allActs.forEach(act => {
                (act.completionHistory || []).forEach(e => {
                    if (!e.isPenalty) daySet.add(e.date ? e.date.slice(0, 10) : '');
                });
            });
            const activeDays = daySet.size;

            const statsGrid = document.getElementById('profileStatsGrid');
            if (statsGrid) {
                const tiles = [
                    { val: totalXP.toLocaleString(), lbl: 'Total XP' },
                    { val: totalComps.toLocaleString(), lbl: 'Completions' },
                    { val: bestStreak, lbl: 'Best Streak' },
                    { val: activeDays, lbl: 'Active Days' },
                    { val: actCount, lbl: 'Activities' },
                    { val: dimCount, lbl: 'Dimensions' },
                ];
                statsGrid.innerHTML = tiles.map(t => `
                    <div class="profile-stat-tile">
                        <div class="profile-stat-val">${t.val}</div>
                        <div class="profile-stat-lbl">${t.lbl}</div>
                    </div>`).join('');
            }

            // ── Friend code ───────────────────────────────────────────────
            const codeEl = document.getElementById('profileFriendCodeVal');
            if (codeEl) codeEl.textContent = data.friendCode || '—';

            // ── Spider chart ──────────────────────────────────────────────
            renderProfileSpiderChart();

            // ── Spider config (if open) ───────────────────────────────────
            const configBody = document.getElementById('spiderConfigBody');
            if (configBody && configBody.style.display !== 'none') {
                renderSpiderConfigList();
            }
        }

        // ── Profile Spider Chart ──────────────────────────────────────────
        // Identical drawing logic to renderLifeSpiderChart but reads
        // getProfileCategoryXP() (tag-based) instead of dimension lifeCategory.
        function renderProfileSpiderChart() {
            const container = document.getElementById('profileSpiderContainer');
            if (!container) return;

            const catXP = getProfileCategoryXP();
            const cats  = window.LIFE_CATEGORIES;
            const filledCount = cats.filter(c => catXP[c.id] > 0).length;

            const legendEl = document.getElementById('profileSpiderLegend');

            if (filledCount < 1) {
                container.innerHTML = `
                    <div class="spider-empty" style="text-align:center;padding:28px 20px;color:var(--color-text-secondary);font-size:13px;line-height:1.6;max-width:400px;margin:0 auto;">
                        <div style="font-size:32px;margin-bottom:10px;">🕸️</div>
                        <p style="font-weight:600;color:var(--color-text-primary);margin-bottom:6px;">No category data yet</p>
                        <p>Use "Configure Life Categories" below to assign activities to life areas.</p>
                    </div>`;
                if (legendEl) legendEl.innerHTML = '';
                return;
            }

            const totalCatXP = Object.values(catXP).reduce((s, v) => s + v, 0);

            // Spider chart scaling: edge = totalXP, zero-point starts at 40% from center
            // This shows proportional spread across categories without exaggerating the leader
            const BASE_FRAC = 0.4; // 0 XP (with data) starts here; totalXP reaches edge
            const FLOOR_FRAC = 0.05; // minimum radius even for 0-XP axes (prevents line-degeneration)
            const spiderR = (xp) => {
                if (xp <= 0) return R * FLOOR_FRAC;
                return R * (BASE_FRAC + (1 - BASE_FRAC) * (xp / totalCatXP));
            };

            const DPR = window.devicePixelRatio || 1;
            const rawSize = container.clientWidth || container.offsetWidth || 0;
            if (rawSize === 0) {
                setTimeout(() => { try { renderProfileSpiderChart(); } catch(e) {} }, 300);
                return;
            }
            const SIZE = Math.min(rawSize, 340);

            let canvas = container.querySelector('canvas.profile-spider-canvas');
            if (!canvas) {
                canvas = document.createElement('canvas');
                canvas.className = 'profile-spider-canvas';
                canvas.style.cssText = 'display:block;width:100%;max-width:340px;margin:0 auto;';
                container.innerHTML = '';
                container.appendChild(canvas);
            }
            canvas.width  = SIZE * DPR;
            canvas.height = SIZE * DPR;
            const ctx = canvas.getContext('2d');
            ctx.scale(DPR, DPR);

            const cx = SIZE / 2, cy = SIZE / 2;
            const R  = SIZE * 0.36;
            const N  = cats.length;
            const angle = i => (Math.PI * 2 * i / N) - Math.PI / 2;

            const root        = getComputedStyle(document.documentElement);
            const textSec     = root.getPropertyValue('--color-text-secondary').trim() || '#b0b0b0';
            const borderColor = root.getPropertyValue('--color-border').trim() || '#3a3a3a';

            // Grid rings
            [0.25, 0.5, 0.75, 1].forEach(frac => {
                ctx.beginPath();
                cats.forEach((_, i) => {
                    const r = R * frac;
                    const x = cx + r * Math.cos(angle(i));
                    const y = cy + r * Math.sin(angle(i));
                    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
                });
                ctx.closePath();
                ctx.strokeStyle = `rgba(255,255,255,${frac === 1 ? 0.10 : 0.05})`;
                ctx.lineWidth = 0.8;
                ctx.stroke();
            });

            // Spokes
            cats.forEach((_, i) => {
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(cx + R * Math.cos(angle(i)), cy + R * Math.sin(angle(i)));
                ctx.strokeStyle = 'rgba(255,255,255,0.07)';
                ctx.lineWidth = 0.8;
                ctx.stroke();
            });

            // Fill polygon
            ctx.beginPath();
            cats.forEach((c, i) => {
                const r = spiderR(catXP[c.id]);
                const x = cx + r * Math.cos(angle(i));
                const y = cy + r * Math.sin(angle(i));
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            });
            ctx.closePath();
            ctx.fillStyle   = 'rgba(90,127,212,0.18)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(90,127,212,0.7)';
            ctx.lineWidth   = 1.5;
            ctx.stroke();

            // Data point dots
            cats.forEach(c => {
                const r = spiderR(catXP[c.id]);
                const x = cx + r * Math.cos(angle(cats.indexOf(c)));
                const y = cy + r * Math.sin(angle(cats.indexOf(c)));
                if (catXP[c.id] > 0) {
                    ctx.beginPath();
                    ctx.arc(x, y, 3, 0, Math.PI * 2);
                    ctx.fillStyle = c.color;
                    ctx.fill();
                }
            });

            // Axis labels
            cats.forEach((c, i) => {
                const labelR = R + 22;
                const x = cx + labelR * Math.cos(angle(i));
                const y = cy + labelR * Math.sin(angle(i));
                ctx.font = `bold ${SIZE < 260 ? 9 : 10}px sans-serif`;
                ctx.fillStyle = catXP[c.id] > 0 ? c.color : textSec;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`${c.emoji} ${c.label}`, x, y);
            });

            // XP label at each data point
            cats.forEach((c, i) => {
                const xp = catXP[c.id];
                if (xp <= 0) return;
                const r = spiderR(xp);
                const x = cx + r * Math.cos(angle(i));
                const y = cy + r * Math.sin(angle(i));
                ctx.font = `600 9px sans-serif`;
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const label = xp >= 1000 ? `${(xp/1000).toFixed(1)}k` : String(xp);
                const tw = ctx.measureText(label).width;
                ctx.fillStyle = 'rgba(0,0,0,0.55)';
                ctx.fillRect(x - tw/2 - 3, y - 7, tw + 6, 14);
                ctx.fillStyle = '#fff';
                ctx.fillText(label, x, y);
            });

            // Legend
            if (legendEl) {
                legendEl.innerHTML = cats.map(c => {
                    const xp = catXP[c.id];
                    const pct = totalCatXP > 0 ? Math.round(xp / totalCatXP * 100) : 0;
                    return `<span class="spider-legend-item" style="color:${xp > 0 ? c.color : textSec};opacity:${xp > 0 ? 1 : 0.4};">
                        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${xp > 0 ? c.color : borderColor};margin-right:4px;vertical-align:middle;"></span>
                        ${c.emoji} ${c.label}
                        ${xp > 0 ? `<span style="color:${textSec};font-weight:400;">&nbsp;${xp.toLocaleString()} XP · ${pct}%</span>` : `<span style="color:${textSec};font-weight:400;opacity:0.5;"> no data</span>`}
                    </span>`;
                }).join('');
            }
        }

        // ── Spider Config ─────────────────────────────────────────────────
        window.toggleSpiderConfig = function() {
            const body    = document.getElementById('spiderConfigBody');
            const chevron = document.getElementById('spiderConfigChevron');
            if (!body) return;
            const isOpen = body.style.display === 'none';
            body.style.display = isOpen ? 'block' : 'none';
            if (chevron) chevron.style.transform = isOpen ? 'rotate(180deg)' : '';
            if (isOpen) renderSpiderConfigList();
        };

        function renderSpiderConfigList() {
            const container = document.getElementById('spiderConfigList');
            if (!container) return;
            const tags = (window.userData.profile && window.userData.profile.spiderTags) || {};

            let html = '';
            (window.userData.dimensions || []).forEach(dim => {
                const acts = [];
                (dim.paths || []).forEach(path => {
                    (path.activities || []).forEach(act => acts.push(act));
                });
                if (!acts.length) return;

                html += `<div class="spider-cfg-dim-header">${escapeHtml(dim.name)}</div>`;

                acts.forEach(act => {
                    const currentTag = tags[act.id] || '';
                    const pillsHtml = window.LIFE_CATEGORIES.map(c => {
                        const isActive = currentTag === c.id;
                        const rgb = _hexToRgbStr(c.color);
                        const activeStyle = isActive
                            ? `background:${c.color};border-color:${c.color};color:#fff;`
                            : `background:rgba(${rgb},0.08);border-color:rgba(${rgb},0.22);color:${c.color};`;
                        return `<button class="spider-cfg-pill${isActive ? ' active' : ''}"
                            style="${activeStyle}"
                            onclick="setSpiderTag('${escapeHtml(act.id)}','${isActive ? '' : c.id}')">${c.emoji} ${c.label}</button>`;
                    }).join('');

                    // Two-row layout: activity name top, pills bottom — no truncation
                    html += `<div class="spider-cfg-row">
                        <div class="spider-cfg-name">${escapeHtml(act.name)}</div>
                        <div class="spider-cfg-pills">${pillsHtml}</div>
                    </div>`;
                });
            });

            if (!html) {
                html = '<p style="font-size:13px;color:var(--color-text-secondary);text-align:center;padding:16px 0;">No activities yet. Create activities in the Dimensions tab first.</p>';
            }
            container.innerHTML = html;
        }

        window.setSpiderTag = async function(actId, catId) {
            if (!window.userData.profile) window.userData.profile = {};
            if (!window.userData.profile.spiderTags) window.userData.profile.spiderTags = {};

            if (!catId) {
                delete window.userData.profile.spiderTags[actId];
            } else {
                window.userData.profile.spiderTags[actId] = catId;
            }
            await saveUserData();
            renderSpiderConfigList();
            renderProfileSpiderChart();
        };

        // ── Username editing ──────────────────────────────────────────────
        window.startUsernameEdit = function() {
            const display = document.getElementById('profileUsernameDisplay');
            const edit    = document.getElementById('profileUsernameEdit');
            const input   = document.getElementById('profileUsernameInput');
            if (!display || !edit || !input) return;
            const current = (window.userData.profile && window.userData.profile.username)
                || window.currentUser.displayName || '';
            input.value = current;
            display.style.display = 'none';
            edit.style.display    = 'block';
            setTimeout(() => input.focus(), 60);
        };

        window.cancelUsernameEdit = function() {
            document.getElementById('profileUsernameDisplay').style.display = 'flex';
            document.getElementById('profileUsernameEdit').style.display    = 'none';
        };

        window.profileUsernameKeydown = function(e) {
            if (e.key === 'Enter') window.saveUsername();
            if (e.key === 'Escape') window.cancelUsernameEdit();
        };

        window.saveUsername = async function() {
            const input = document.getElementById('profileUsernameInput');
            if (!input) return;
            const val = input.value.trim();
            if (!val) return;
            if (!window.userData.profile) window.userData.profile = {};
            window.userData.profile.username = val;
            await saveUserData();
            // Update header avatar initial if no photo
            updateProfileAvatar();
            // Re-render
            window.cancelUsernameEdit();
            const text = document.getElementById('profileUsernameText');
            if (text) text.textContent = val;
            const titleEl = document.getElementById('profileCharTitle');
            if (titleEl) titleEl.textContent = getCharacterTitle(window.userData.level || 1, getProfileCategoryXP());
            showToast('Username saved ✓', 'olive');
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
            // Close profile overlay immediately so user sees the auth screen
            const overlay = document.getElementById('profileOverlay');
            if (overlay) overlay.style.display = 'none';
            document.body.style.overflow = '';
            try {
                await signOut(auth);
            } catch (error) {
                console.error('Logout error:', error);
            }
        };

        // ── Profile overlay back-button support ───────────────────────────
        // Push a history state when the profile opens, pop it on close.
        // This makes the browser/mobile back button close the overlay naturally.
        window.openProfileOverlay = (function(_orig) {
            return function() {
                _orig();
                // Push state so back-button can close it
                history.pushState({ profileOpen: true }, '');
            };
        })(window.openProfileOverlay);

        window.closeProfileOverlay = (function(_orig) {
            return function(fromPopState) {
                _orig();
                // If closed by user (not by popstate), pop the history state we pushed
                if (!fromPopState) {
                    if (history.state && history.state.profileOpen) history.back();
                }
            };
        })(window.closeProfileOverlay);

        window.addEventListener('popstate', function(e) {
            const overlay = document.getElementById('profileOverlay');
            if (overlay && overlay.style.display !== 'none') {
                // Close without pushing another history entry
                document.getElementById('profileOverlay').style.display = 'none';
                document.body.style.overflow = '';
            }
        });

        // Error Handling
        function showError(message) {
            const errorDiv = document.getElementById('authError');
            errorDiv.textContent = message;
        }

        function hideError() {
            const errorDiv = document.getElementById('authError');
            errorDiv.textContent = '';
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
                window._mkDeferredPrompt = e;
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


        // ── Landing Page: Platform Detection & Install Card ───────────────────
        function initAuthScreen() {
            const authContainer = document.getElementById('authContainer');
            const installSection = document.getElementById('lpInstallSection');
            const loginLabel = document.getElementById('lpLoginLabel');
            const installCard = document.getElementById('lpInstallCard');
            if (!authContainer) return;

            const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                               || window.navigator.standalone === true;

            if (isStandalone) {
                authContainer.classList.add('auth-installed');
                if (installSection) installSection.style.display = 'none';
                if (loginLabel) loginLabel.style.display = 'none';
                return;
            }

            const ua = navigator.userAgent;
            const isIOS    = /iphone|ipad|ipod/i.test(ua);
            const isAndroid = /android/i.test(ua);
            const isChrome  = /chrome/i.test(ua) && !/edge|opr/i.test(ua);

            if (isIOS) {
                if (installCard) installCard.innerHTML = `
                    <div class="lp-install-card-title">
                        <div class="lp-install-card-title-icon">📲</div>
                        Add to Home Screen
                    </div>
                    <ul class="lp-steps">
                        <li class="lp-step">
                            <div class="lp-step-num">1</div>
                            <div class="lp-step-text">Tap the <strong>Share</strong> icon
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;opacity:0.75;display:inline-block;"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                                at the bottom of Safari
                            </div>
                        </li>
                        <li class="lp-step">
                            <div class="lp-step-num">2</div>
                            <div class="lp-step-text">Scroll down and tap <strong>"Add to Home Screen"</strong></div>
                        </li>
                        <li class="lp-step">
                            <div class="lp-step-num">3</div>
                            <div class="lp-step-text">Tap <strong>"Add"</strong> in the top-right corner</div>
                        </li>
                    </ul>`;
                if (loginLabel) loginLabel.textContent = 'Or use on Web';

            } else if (isAndroid || isChrome) {
                if (installCard) installCard.innerHTML = `
                    <div class="lp-install-card-title">
                        <div class="lp-install-card-title-icon">📲</div>
                        Install the App
                    </div>
                    <button class="lp-native-install-btn" id="lpNativeInstallBtn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Install Mindkraft — Free
                    </button>
                    <div class="lp-install-fallback" id="lpInstallFallback" style="display:none;">
                        Or tap <strong>⋮ Menu</strong> → <strong>Add to Home screen</strong>
                    </div>`;
                setTimeout(() => {
                    const btn = document.getElementById('lpNativeInstallBtn');
                    if (!btn) return;
                    if (window._mkDeferredPrompt) {
                        btn.addEventListener('click', () => {
                            window._mkDeferredPrompt.prompt();
                            window._mkDeferredPrompt.userChoice.then(r => {
                                if (r.outcome === 'accepted') {
                                    if (installSection) installSection.style.display = 'none';
                                    if (loginLabel) loginLabel.style.display = 'none';
                                }
                                window._mkDeferredPrompt = null;
                            });
                        });
                    } else {
                        btn.style.display = 'none';
                        const fb = document.getElementById('lpInstallFallback');
                        if (fb) fb.style.display = 'block';
                    }
                }, 500);
                if (loginLabel) loginLabel.textContent = 'Or use on Web';

            } else {
                if (installCard) installCard.innerHTML = `
                    <div class="lp-install-card-title">
                        <div class="lp-install-card-title-icon">💡</div>
                        Best experience in Chrome
                    </div>
                    <ul class="lp-steps">
                        <li class="lp-step">
                            <div class="lp-step-num">1</div>
                            <div class="lp-step-text">Open this page in <strong>Chrome</strong> on your phone or desktop</div>
                        </li>
                        <li class="lp-step">
                            <div class="lp-step-num">2</div>
                            <div class="lp-step-text">Tap <strong>"Install Mindkraft"</strong> in the address bar or menu</div>
                        </li>
                    </ul>`;
                if (loginLabel) loginLabel.textContent = 'Continue anyway';
            }
        }

        // ── Onboarding Overlay ────────────────────────────────────────────────
        let _obCurrentSlide = 0;
        const OB_TOTAL_SLIDES = 3;

        window.showOnboardingOverlay = function() {
            const overlay = document.getElementById('onboardingOverlay');
            if (!overlay) return;
            overlay.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            _obCurrentSlide = 0;
            obRenderSlide(0);
            // Animate XP bar and level tick on slide 1
            setTimeout(() => {
                const fill = document.getElementById('obXpFill');
                if (fill) fill.style.width = '72%';
                setTimeout(() => {
                    const lvEl = document.getElementById('obLvNum');
                    if (lvEl) lvEl.textContent = '2';
                }, 1600);
            }, 400);
        };

        function obRenderSlide(n) {
            for (let i = 0; i < OB_TOTAL_SLIDES; i++) {
                const s = document.getElementById('obSlide' + i);
                if (s) {
                    if (i === n) {
                        s.style.display = 'flex';
                        s.style.animation = 'none';
                        void s.offsetHeight; // force reflow to re-trigger animation
                        s.style.animation = '';
                    } else {
                        s.style.display = 'none';
                    }
                }
            }
            const dots = document.querySelectorAll('.ob-dot');
            dots.forEach((d, i) => d.classList.toggle('ob-dot-active', i === n));
            const backBtn = document.getElementById('obBackBtn');
            if (backBtn) backBtn.style.visibility = n > 0 ? 'visible' : 'hidden';
            const nextBtn = document.getElementById('obNextBtn');
            if (nextBtn) nextBtn.textContent = n === OB_TOTAL_SLIDES - 1 ? "Let's go →" : 'Next →';
            _obCurrentSlide = n;
        }

        window.obNext = function() {
            if (_obCurrentSlide < OB_TOTAL_SLIDES - 1) {
                obRenderSlide(_obCurrentSlide + 1);
            } else {
                obShowChoiceScreen();
            }
        };

        window.obBack = function() {
            if (_obCurrentSlide > 0) obRenderSlide(_obCurrentSlide - 1);
        };

        window.obGoTo = function(n) {
            if (n >= 0 && n < OB_TOTAL_SLIDES) obRenderSlide(n);
        };

        function obShowChoiceScreen() {
            const slides = document.getElementById('obSlides');
            const dots   = document.getElementById('obDots');
            const nav    = document.getElementById('obNav');
            const choice = document.getElementById('obChoiceScreen');
            if (slides) slides.style.display = 'none';
            if (dots)   dots.style.display = 'none';
            if (nav)    nav.style.display = 'none';
            if (choice) { choice.style.display = 'flex'; choice.style.flexDirection = 'column'; }
        }

        window.obQuickStart = async function() {
            // Quick Start now routes into the focus-area picker flow.
            // The actual activity creation happens at obFinishPicker.
            obShowFocusPicker();
        };

        window.obBuildOwn = async function() {
            window.userData.onboardingComplete = true;
            await saveUserData().catch(() => {});
            obCloseOverlay();
            showToast('Welcome to Mindkraft! Create your first activity to get started.', 'blue');
            if (window.switchTab) switchTab('activities');
            initTutorial();
        };

        function obCloseOverlay() {
            const overlay = document.getElementById('onboardingOverlay');
            if (overlay) overlay.style.display = 'none';
            document.body.style.overflow = '';
        }

        async function createDefaultOnboardingData() {
            // Safety guard: never overwrite a real user's data.
            if ((window.userData.dimensions || []).length > 0 ||
                (window.userData.totalXP || 0) > 0 ||
                (window.userData.level || 1) > 1) {
                console.warn('createDefaultOnboardingData: existing user data detected — skipping template write.');
                window.userData.onboardingComplete = true;
                await saveUserData().catch(() => {});
                return;
            }

            // Empty start: no seeded activities, no seeded challenges.
            // Activities are added via the focus-area picker (obFocusPicker) when
            // the user chooses Quick Start, or by the user manually when they pick
            // Build My Own. Challenges are not seeded since the Challenges tab is
            // locked until Level 5.
            window.userData.dimensions = [];
            window.userData.challenges = [];

            window.userData.onboardingComplete = true;
            await saveUserData();
            updateDashboard();
        }

        // ── Focus-area picker library ─────────────────────────────────────────
        // Each entry is a starter activity that gets injected into the user's
        // 'Uncategorized' bucket if they pick it during the focus picker flow.
        // Fields mirror the activity schema used by makeAct() — anything
        // omitted falls back to the schema defaults.
        const FOCUS_AREAS = [
            {
                id: 'health',
                label: 'Health',
                emoji: '💪',
                subtitle: 'Body, energy, physical longevity',
                activities: [
                    { name: 'Morning Walk / Run', baseXP: 15, frequency: 'daily',
                      description: '15–30 minutes of movement to start the day.' },
                    { name: 'Drink 8 Glasses of Water', baseXP: 10, frequency: 'daily',
                      description: 'Simple hydration anchor — easy daily win.' },
                    { name: 'No Junk Food Today', baseXP: 15, frequency: 'daily',
                      isSkipNegative: true, negativeXpMode: 'perform',
                      description: 'A skip-negative — logging it costs XP. Restraint earns the win.' },
                    { name: 'Sleep by 11 PM', baseXP: 15, frequency: 'daily',
                      description: 'Lights out by 11. Sleep hygiene anchor.' },
                ],
            },
            {
                id: 'mind',
                label: 'Mind',
                emoji: '🧠',
                subtitle: 'Focus, learning, emotional clarity',
                activities: [
                    { name: 'Read 20 Minutes', baseXP: 15, frequency: 'daily',
                      description: 'Compounds over weeks. Any format counts.' },
                    { name: 'Journal Entry', baseXP: 15, frequency: 'daily',
                      description: 'A few sentences. Self-reflection and emotional processing.' },
                    { name: '10-Minute Meditation', baseXP: 15, frequency: 'daily',
                      description: 'Sit, breathe, return. Pairs well with streak mechanics.' },
                    { name: 'Learn Something New', baseXP: 20, frequency: 'occasional',
                      description: 'Article, video, podcast, course — keeps it flexible.' },
                ],
            },
            {
                id: 'social',
                label: 'Social',
                emoji: '🤝',
                subtitle: 'Relationships and connection',
                activities: [
                    { name: 'Reach Out to Someone', baseXP: 20, frequency: 'weekly',
                      description: 'A text, a call, a coffee. Once a week.' },
                    { name: 'Quality Time with Family', baseXP: 20, frequency: 'weekly',
                      description: 'No screens. Just present.' },
                    { name: 'Random Act of Kindness', baseXP: 25, frequency: 'occasional',
                      description: 'Low pressure, high meaning. Log it when it happens.' },
                    { name: 'Decline a Draining Commitment', baseXP: 20, frequency: 'occasional',
                      isNegative: false,
                      description: 'Healthy boundaries are a win — log when you say no.' },
                ],
            },
            {
                id: 'craft',
                label: 'Craft',
                emoji: '🛠️',
                subtitle: 'Skill, mastery, the work you make',
                activities: [
                    { name: 'Deep Work Session', baseXP: 25, frequency: 'daily',
                      description: '60+ minutes of uninterrupted focus on the thing that matters.' },
                    { name: 'Practice My Craft', baseXP: 15, frequency: 'daily',
                      description: 'Whatever you\'re trying to get good at. Time on the tool.' },
                    { name: 'Ship Something Small', baseXP: 30, frequency: 'weekly',
                      description: 'Finish and publish one thing. Done > perfect.' },
                    { name: 'Study a Skill Resource', baseXP: 20, frequency: 'occasional',
                      description: 'Book chapter, course module, deep article. Anti-fluff.' },
                ],
            },
        ];

        // Picker state — lives on window so the screens can read/write across renders.
        window._obPickerState = {
            selectedAreas: [],     // up to 2 area ids
            selectedActivities: [],// up to 4 activity keys "<areaId>:<index>"
        };

        // ── Step 1: focus area picker ─────────────────────────────────────────
        window.obShowChoiceScreenAgain = function() {
            const picker = document.getElementById('obFocusPicker');
            const choice = document.getElementById('obChoiceScreen');
            if (picker) picker.style.display = 'none';
            if (choice) { choice.style.display = 'flex'; choice.style.flexDirection = 'column'; }
        };

        window.obShowFocusPicker = function() {
            // Reset state every time the picker is opened
            window._obPickerState = { selectedAreas: [], selectedActivities: [] };
            const slides = document.getElementById('obSlides');
            const dots   = document.getElementById('obDots');
            const nav    = document.getElementById('obNav');
            const choice = document.getElementById('obChoiceScreen');
            const picker = document.getElementById('obFocusPicker');
            if (slides) slides.style.display = 'none';
            if (dots)   dots.style.display = 'none';
            if (nav)    nav.style.display = 'none';
            if (choice) choice.style.display = 'none';
            if (!picker) return;
            picker.style.display = 'flex';

            // Render the four area cards
            const grid = document.getElementById('obFocusGrid');
            if (grid) {
                grid.innerHTML = FOCUS_AREAS.map(area => `
                    <button type="button" class="ob-area-card" data-area="${area.id}"
                            onclick="obToggleArea('${area.id}')">
                        <div class="ob-area-emoji">${area.emoji}</div>
                        <div class="ob-area-label">${area.label}</div>
                        <div class="ob-area-sub">${escapeHtml(area.subtitle)}</div>
                        <div class="ob-area-check">✓</div>
                    </button>
                `).join('');
            }
            obUpdateFocusNextBtn();
        };

        window.obToggleArea = function(areaId) {
            const st = window._obPickerState;
            const i = st.selectedAreas.indexOf(areaId);
            if (i >= 0) {
                st.selectedAreas.splice(i, 1);
            } else {
                if (st.selectedAreas.length >= 2) {
                    showToast('Pick up to 2 areas to focus on.', 'red');
                    return;
                }
                st.selectedAreas.push(areaId);
            }
            // Reflect selection in the DOM
            document.querySelectorAll('#obFocusGrid .ob-area-card').forEach(card => {
                card.classList.toggle('ob-area-selected',
                    st.selectedAreas.includes(card.dataset.area));
            });
            obUpdateFocusNextBtn();
        };

        function obUpdateFocusNextBtn() {
            const btn = document.getElementById('obFocusNextBtn');
            if (!btn) return;
            const n = window._obPickerState.selectedAreas.length;
            btn.disabled = (n === 0);
            btn.textContent = n === 0 ? 'Pick at least one →' : 'Next →';
        }

        // ── Step 2: activity picker (max 4 across chosen areas) ───────────────
        window.obShowActivityPicker = function() {
            const st = window._obPickerState;
            if (st.selectedAreas.length === 0) return;
            const picker = document.getElementById('obFocusPicker');
            const actPicker = document.getElementById('obActivityPicker');
            if (picker) picker.style.display = 'none';
            if (!actPicker) return;
            actPicker.style.display = 'flex';
            st.selectedActivities = [];

            const wrap = document.getElementById('obActivityGroups');
            if (wrap) {
                wrap.innerHTML = st.selectedAreas.map(areaId => {
                    const area = FOCUS_AREAS.find(a => a.id === areaId);
                    if (!area) return '';
                    const items = area.activities.map((act, idx) => {
                        const key = `${areaId}:${idx}`;
                        const freqLabel = act.frequency === 'daily' ? 'daily'
                                       : act.frequency === 'weekly' ? 'weekly'
                                       : act.frequency === 'occasional' ? 'occasional'
                                       : act.frequency;
                        return `
                            <button type="button" class="ob-activity-row" data-key="${key}"
                                    onclick="obToggleActivity('${key}')">
                                <div class="ob-activity-check"></div>
                                <div class="ob-activity-text">
                                    <div class="ob-activity-name">${escapeHtml(act.name)}</div>
                                    <div class="ob-activity-meta">${freqLabel} · +${act.baseXP} XP</div>
                                </div>
                            </button>`;
                    }).join('');
                    return `
                        <div class="ob-activity-group">
                            <div class="ob-activity-group-header">
                                <span class="ob-activity-group-emoji">${area.emoji}</span>
                                <span class="ob-activity-group-label">${area.label}</span>
                            </div>
                            <div class="ob-activity-list">${items}</div>
                        </div>`;
                }).join('');
            }
            obUpdateActivityProgress();
        };

        window.obToggleActivity = function(key) {
            const st = window._obPickerState;
            const i = st.selectedActivities.indexOf(key);
            if (i >= 0) {
                st.selectedActivities.splice(i, 1);
            } else {
                if (st.selectedActivities.length >= 4) {
                    showToast('You can pick up to 4 activities.', 'red');
                    return;
                }
                st.selectedActivities.push(key);
            }
            document.querySelectorAll('#obActivityGroups .ob-activity-row').forEach(row => {
                row.classList.toggle('ob-activity-selected',
                    st.selectedActivities.includes(row.dataset.key));
            });
            obUpdateActivityProgress();
        };

        function obUpdateActivityProgress() {
            const n = window._obPickerState.selectedActivities.length;
            const fill = document.getElementById('obActivityProgressFill');
            const label = document.getElementById('obActivityProgressLabel');
            const btn = document.getElementById('obActivityFinishBtn');
            if (fill) fill.style.width = (n / 4 * 100) + '%';
            if (label) label.textContent = `${n} of 4 selected`;
            if (btn) {
                btn.disabled = (n === 0);
                btn.textContent = n === 0 ? 'Pick at least one →' : `Add ${n} activit${n === 1 ? 'y' : 'ies'} →`;
            }
        }

        window.obBackToFocus = function() {
            const actPicker = document.getElementById('obActivityPicker');
            const picker = document.getElementById('obFocusPicker');
            if (actPicker) actPicker.style.display = 'none';
            if (picker) picker.style.display = 'flex';
        };

        window.obFinishPicker = async function() {
            const st = window._obPickerState;
            if (st.selectedActivities.length === 0) return;

            const actPicker = document.getElementById('obActivityPicker');
            if (actPicker) actPicker.innerHTML = `
                <div class="ob-loading">
                    <div class="ob-loading-spinner"></div>
                    <div>Setting up your space…</div>
                </div>`;

            try {
                await createDefaultOnboardingData(); // sets onboardingComplete + saves
                // Now inject the chosen activities into the Uncategorized bucket
                // using the existing helper (creates dim+path with the canonical
                // 'uncategorized' sentinel IDs if not already present).
                const now = new Date().toISOString();
                const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
                const { di, pi } = getOrCreateUncategorized();
                const targetPath = window.userData.dimensions[di].paths[pi];
                if (!targetPath.activities) targetPath.activities = [];

                st.selectedActivities.forEach(key => {
                    const [areaId, idxStr] = key.split(':');
                    const area = FOCUS_AREAS.find(a => a.id === areaId);
                    if (!area) return;
                    const tpl = area.activities[parseInt(idxStr, 10)];
                    if (!tpl) return;
                    const act = {
                        id: uid(),
                        name: tpl.name,
                        baseXP: tpl.baseXP,
                        frequency: tpl.frequency,
                        description: tpl.description || '',
                        isNegative: !!tpl.isNegative,
                        isSkipNegative: !!tpl.isSkipNegative,
                        negativeXpMode: tpl.negativeXpMode || (tpl.isNegative ? 'perform' : 'skip'),
                        completionHistory: [],
                        cycleHistory: [],
                        streakShields: 3,
                        lastCompleted: null,
                        totalXP: 0,
                        isFavorite: false,
                        createdAt: now,
                    };
                    targetPath.activities.push(act);
                });

                await saveUserData();
                obCloseOverlay();
                showToast('🎉 Your space is ready! Tap an activity to log it.', 'blue');
                if (window.switchTab) switchTab('activities');
                // Mark the create-first-activity tutorial step as complete since the
                // user already has activities. Tab unlock spotlights will fire later.
                window.userData.tutorialStep = 99; // done
                saveUserData().catch(() => {});
                updateDashboard();
            } catch (e) {
                console.error('Picker finish error:', e);
                obCloseOverlay();
                showToast('Welcome to Mindkraft!', 'blue');
            }
        };


        // ── Tutorial System ───────────────────────────────────────────────────
        //
        // tutorialStep stored on userData:
        //   -1 / undefined = not started
        //    0  = waiting for user to create first activity (centered modal)
        //    99 = first-activity step complete (set by picker finish or after add)
        //
        // Tab-specific intros (Friends / Challenges / Analytics) are NOT part of
        // this sequence anymore. They fire as level-unlock spotlights when the
        // user crosses the unlock threshold and opens the app on the next session.

        const TUTORIAL_STEPS = [
            {
                emoji: '🎯',
                title: 'Create your first activity',
                body: 'Activities are the habits and tasks you want to track. Tap the button below to create your first one and start earning XP!',
                cta: '+ Create Activity',
                action: 'openActivityModal(null,null); hideTutorialOverlay();',
                tab: null
            }
        ];

        // ── Level locks & unlock metadata ─────────────────────────────────────
        // Tabs are visible at all levels but disabled until the user reaches
        // the threshold. Tapping a locked tab shows a toast explaining when it
        // unlocks. On the next app load after crossing the threshold, an unlock
        // popup + spotlight intro fires for that tab.
        const TAB_UNLOCKS = {
            analytics:  { level: 3, label: 'Analytics',  emoji: '📊',
                          body: 'Track XP over time, see which habits are building streaks, and measure progress across every area of your life.' },
            challenges: { level: 5, label: 'Challenges', emoji: '🏆',
                          body: 'Set personal challenges tied to your activities — with a deadline and bonus XP when you complete them.' },
            friends:    { level: 7, label: 'Friends',    emoji: '👥',
                          body: 'Add friends, compare XP on the leaderboard, and keep each other accountable. Share your friend code to get started.' },
        };

        function isTabUnlocked(tabName) {
            const meta = TAB_UNLOCKS[tabName];
            if (!meta) return true; // tabs not in the map (activities, settings) are always unlocked
            const lvl = (window.userData && window.userData.level) || 1;
            return lvl >= meta.level;
        }
        window.isTabUnlocked = isTabUnlocked;

        // Apply locked styling/aria to nav tabs. Called from updateDashboard.
        function applyTabLockStyling() {
            document.querySelectorAll('.nav-tab').forEach(tab => {
                const onclick = tab.getAttribute('onclick') || '';
                const m = onclick.match(/switchTab\('(\w+)'\)/);
                if (!m) return;
                const tabName = m[1];
                const meta = TAB_UNLOCKS[tabName];
                if (!meta) return; // not a lockable tab
                const locked = !isTabUnlocked(tabName);
                tab.classList.toggle('nav-tab-locked', locked);
                if (locked) {
                    tab.setAttribute('aria-disabled', 'true');
                    tab.setAttribute('data-unlock-level', meta.level);
                } else {
                    tab.removeAttribute('aria-disabled');
                    tab.removeAttribute('data-unlock-level');
                }
            });
        }
        window.applyTabLockStyling = applyTabLockStyling;

        // ── Spotlight overlay ─────────────────────────────────────────────────
        // Cuts a transparent rounded rect over the target nav tab using the
        // box-shadow trick, then renders an explanation card on the opposite
        // side. The spotlight is fired by showTabUnlockSpotlight(tabName).
        function showTabUnlockSpotlight(tabName) {
            const meta = TAB_UNLOCKS[tabName];
            if (!meta) return;
            // Make sure the target tab is currently visible (it always is in the
            // bottom nav, but switchTab to its content first so the user sees
            // what the spotlight is teaching).
            // We do NOT switchTab() here because we want the spotlight to point
            // at the nav button, and switching tabs auto-runs the tab's render
            // which may be heavy. Instead we let the user tap.
            const tabBtn = document.querySelector(`.nav-tab[onclick="switchTab('${tabName}')"]`);
            const overlay = document.getElementById('spotlightOverlay');
            const cutout  = document.getElementById('spotlightCutout');
            const card    = document.getElementById('spotlightCard');
            if (!tabBtn || !overlay || !cutout || !card) return;

            const rect = tabBtn.getBoundingClientRect();
            const pad = 6; // padding around the highlighted button
            cutout.style.left   = (rect.left - pad) + 'px';
            cutout.style.top    = (rect.top  - pad) + 'px';
            cutout.style.width  = (rect.width  + pad * 2) + 'px';
            cutout.style.height = (rect.height + pad * 2) + 'px';

            // Position card above the nav (nav lives at the bottom on mobile).
            // On desktop, nav is at the top of the main column, so put card below.
            const isBottom = rect.top > window.innerHeight / 2;
            card.style.left = '50%';
            card.style.transform = 'translateX(-50%)';
            if (isBottom) {
                card.style.bottom = (window.innerHeight - rect.top + 18) + 'px';
                card.style.top = '';
            } else {
                card.style.top = (rect.bottom + 18) + 'px';
                card.style.bottom = '';
            }

            card.innerHTML = `
                <div class="spotlight-emoji">${meta.emoji}</div>
                <h3 class="spotlight-title">${meta.label} unlocked</h3>
                <p class="spotlight-body">${escapeHtml(meta.body)}</p>
                <button class="spotlight-cta" onclick="dismissTabUnlockSpotlight()">Got it →</button>
            `;
            overlay.style.display = 'block';
            document.body.style.overflow = 'hidden';
        }
        window.showTabUnlockSpotlight = showTabUnlockSpotlight;

        window.dismissTabUnlockSpotlight = function() {
            const overlay = document.getElementById('spotlightOverlay');
            if (overlay) overlay.style.display = 'none';
            document.body.style.overflow = '';
            // Continue the queue if more unlocks are pending.
            setTimeout(processNextPendingUnlock, 250);
        };

        // ── Unlock popup queue ────────────────────────────────────────────────
        // unlocksAcknowledged: array of tab names whose unlock popup has been
        // shown. On every app session, we scan TAB_UNLOCKS, find any whose
        // threshold the user has crossed but isn't yet acknowledged, and queue
        // a popup + spotlight for each in level order.
        function findPendingUnlocks() {
            const ud = window.userData;
            if (!ud || !ud.onboardingComplete) return [];
            const ack = ud.unlocksAcknowledged || [];
            const lvl = ud.level || 1;
            return Object.entries(TAB_UNLOCKS)
                .filter(([name, meta]) => lvl >= meta.level && !ack.includes(name))
                .sort((a, b) => a[1].level - b[1].level)
                .map(([name]) => name);
        }

        let _pendingUnlockQueue = [];
        function processNextPendingUnlock() {
            if (_pendingUnlockQueue.length === 0) return;
            const next = _pendingUnlockQueue.shift();
            showTabUnlockPopup(next);
        }

        // First popup is a celebration card; dismissing it fires the spotlight.
        function showTabUnlockPopup(tabName) {
            const meta = TAB_UNLOCKS[tabName];
            if (!meta) return;
            const overlay = document.getElementById('unlockPopupOverlay');
            const card    = document.getElementById('unlockPopupCard');
            if (!overlay || !card) return;
            card.innerHTML = `
                <div class="unlock-popup-eyebrow">YOU UNLOCKED</div>
                <div class="unlock-popup-emoji">${meta.emoji}</div>
                <h2 class="unlock-popup-title">${meta.label} Tab</h2>
                <p class="unlock-popup-body">Reached Level ${meta.level}. A new piece of the app is open to you.</p>
                <button class="unlock-popup-cta" onclick="acknowledgeTabUnlock('${tabName}')">Show me →</button>
            `;
            overlay.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
        window.showTabUnlockPopup = showTabUnlockPopup;

        window.acknowledgeTabUnlock = async function(tabName) {
            // Stamp acknowledgement first so a crash here doesn't loop the popup.
            const ud = window.userData;
            if (!ud) return;
            ud.unlocksAcknowledged = ud.unlocksAcknowledged || [];
            if (!ud.unlocksAcknowledged.includes(tabName)) ud.unlocksAcknowledged.push(tabName);
            applyTabLockStyling(); // refresh styling immediately
            saveUserData().catch(() => {});
            // Hide popup, then show spotlight.
            const overlay = document.getElementById('unlockPopupOverlay');
            if (overlay) overlay.style.display = 'none';
            setTimeout(() => showTabUnlockSpotlight(tabName), 200);
        };

        // Called from main app init after userData is loaded.
        window.checkPendingTabUnlocks = function() {
            // Don't show during onboarding or while the first-activity tutorial
            // is still visible.
            const ud = window.userData;
            if (!ud || !ud.onboardingComplete) return;
            const ts = ud.tutorialStep ?? -1;
            if (ts >= 0 && ts < 99 && ts < TUTORIAL_STEPS.length) return;
            // Don't fire if a modal/overlay is already visible.
            const onboarding = document.getElementById('onboardingOverlay');
            if (onboarding && onboarding.style.display !== 'none' && onboarding.style.display !== '') return;
            _pendingUnlockQueue = findPendingUnlocks();
            if (_pendingUnlockQueue.length > 0) {
                setTimeout(processNextPendingUnlock, 800);
            }
        };

        window.initTutorial = function() {
            // Only start if not already started and onboarding is complete
            if ((window.userData.tutorialStep ?? -1) >= 0) return; // already in progress or done
            window.userData.tutorialStep = 0;
            saveUserData().catch(() => {});
            setTimeout(() => showCurrentTutorialStep(), 600);
        };

        window.showCurrentTutorialStep = function() {
            const step = window.userData.tutorialStep ?? -1;
            if (step < 0 || step >= TUTORIAL_STEPS.length) return;
            const s = TUTORIAL_STEPS[step];
            if (s.tab) switchTab(s.tab);
            const card = document.getElementById('tutorialCard');
            if (!card) return;
            card.innerHTML = `
                <div class="tutorial-progress">Step ${step + 1} of ${TUTORIAL_STEPS.length}</div>
                <div class="tutorial-emoji">${s.emoji}</div>
                <h2 class="tutorial-title">${s.title}</h2>
                <p class="tutorial-body">${s.body}</p>
                <button class="tutorial-cta" onclick="${s.action}">${s.cta}</button>
            `;
            document.getElementById('tutorialOverlay').style.display = 'flex';
            document.body.style.overflow = 'hidden';
        };

        window.hideTutorialOverlay = function() {
            document.getElementById('tutorialOverlay').style.display = 'none';
            document.body.style.overflow = '';
        };

        window.advanceTutorial = async function() {
            // Only one step now — mark complete on advance.
            window.userData.tutorialStep = 99;
            await saveUserData().catch(() => {});
            hideTutorialOverlay();
            // Check whether any tab unlocks should fire next.
            if (typeof checkPendingTabUnlocks === 'function') {
                setTimeout(checkPendingTabUnlocks, 350);
            }
        };

        // ── Categorization Prompt ─────────────────────────────────────────────

        window.checkCategorizationPrompt = function() {
            const ud = window.userData;
            if (!ud || !ud.onboardingComplete) return;
            // Already dismissed this session
            if (window._catPromptDismissed) return;
            // Tutorial not yet complete
            const ts = ud.tutorialStep ?? -1;
            if (ts >= 0 && ts < 4) return;

            // Count uncategorized activities
            const dims = ud.dimensions || [];
            const uncDim = dims.find(d => d.id === 'uncategorized');
            const uncCount = uncDim
                ? (uncDim.paths || []).flatMap(p => p.activities || []).length
                : 0;
            if (uncCount === 0) return;

            // Fire if level >= 5 OR account is 7+ days old
            const level = ud.level || 1;
            const createdAt = ud.createdAt ? new Date(ud.createdAt) : null;
            const daysSince = createdAt
                ? Math.floor((Date.now() - createdAt) / 86400000)
                : 0;
            if (level < 5 && daysSince < 7) return;

            // Show the prompt
            document.getElementById('uncatCount').textContent = uncCount;
            document.getElementById('categorizationPrompt').style.display = 'flex';
            document.body.style.overflow = 'hidden';
        };

        window.goToCategories = function() {
            document.getElementById('categorizationPrompt').style.display = 'none';
            document.body.style.overflow = '';
            window._catPromptDismissed = true;
            switchTab('activities');
            setTimeout(() => switchSubTab('activities', 'categories'), 200);
        };

        window.dismissCategorizationPrompt = function() {
            document.getElementById('categorizationPrompt').style.display = 'none';
            document.body.style.overflow = '';
            window._catPromptDismissed = true;
        };

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
                    var todayKey = localToday();
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

        // ═══════════════════════════════════════════════════════════════════
        // FRIENDS FEATURE
        // ═══════════════════════════════════════════════════════════════════

        // Cache of fetched public profiles for this session {uid: publicProfileData}
        window._friendProfileCache = {};

        // ── Render the full Friends tab ───────────────────────────────────
        // ── Render the full Friends tab ───────────────────────────────────
        window.renderFriendsTab = async function() {
            const lb  = document.getElementById('friendsLeaderboard');
            const add = document.getElementById('friendsAddSection');
            const all = document.getElementById('friendsAllList');
            if (!lb || !add || !all) return;

            lb.innerHTML  = '<div style="padding:8px 0 4px;color:var(--color-text-secondary);font-size:13px;">Loading\u2026</div>';
            add.innerHTML = '';
            all.innerHTML = '';

            const friends     = window.userData.friends || [];
            const myUID       = window.currentUser.uid;
            const currentWeek = getISOWeekLabel();

            // ── 1. Check for pending friend requests (1 query, lazy) ───────
            let pendingRequests = [];
            try {
                const reqQ    = query(collection(db, 'friendRequests'), where('toUID', '==', myUID));
                const reqSnap = await getDocs(reqQ);
                reqSnap.forEach(d => pendingRequests.push({ docId: d.id, ...d.data() }));
            } catch(e) { console.warn('Friend requests fetch failed:', e); }

            // ── 2. Build my own entry from live in-memory data ─────────────
            const catXP = getProfileCategoryXP();
            const myAllActs = [];
            (window.userData.dimensions || []).forEach(d =>
                (d.paths || []).forEach(p => (p.activities || []).forEach(a => myAllActs.push(a))));
            const myDaySet = new Set();
            myAllActs.forEach(a => (a.completionHistory || []).forEach(e => {
                if (!e.isPenalty && e.date) myDaySet.add(e.date.slice(0, 10));
            }));
            const todayStr = localToday();
            const yesterdayStr = localYesterday();
            const myXpToday = myAllActs.reduce((s, a) =>
                s + (a.completionHistory || [])
                    .filter(e => !e.isPenalty && e.date && toLocalDateStr(new Date(e.date)) === todayStr)
                    .reduce((xs, e) => xs + (e.xp || 0), 0)
            , 0) + ((window.userData.xpTodayGhost || {})[todayStr] || 0);
            const myEntry = {
                uid:            myUID,
                displayName:    (window.userData.profile && window.userData.profile.username)
                                || window.currentUser.displayName || 'You',
                photoURL:       window.currentUser.photoURL || null,
                level:          window.userData.level || 1,
                characterTitle: getCharacterTitle(window.userData.level || 1, catXP),
                weeklyXP:       computeWeeklyXP(),
                weeklyXPWeek:   currentWeek,
                xpPerHour:      computeXPPerHour(myAllActs),
                xpPerHourDate:  yesterdayStr,
                xpToday:        myXpToday,
                xpTodayDate:    todayStr,
                totalXP:        (window.userData.totalXP || 0) + (window.userData.xpDeletedGhost || 0),
                categoryXP:     catXP,
                bestStreak:     myAllActs.reduce((m, x) => Math.max(m, x.bestStreak || x.streak || 0), 0),
                activeDays:     myDaySet.size,
                isMe:           true
            };
            window._friendProfileCache[myUID] = myEntry;

            // ── 3. Fetch friend public profiles in parallel (max 20 reads) ──
            let entries = [myEntry];
            if (friends.length > 0) {
                const fetches = friends.map(async uid => {
                    try {
                        const ref  = doc(db, 'publicProfiles', uid);
                        const snap = await getDoc(ref);
                        if (!snap.exists()) return null;
                        const d    = snap.data();
                        const wXP  = (d.weeklyXPWeek === currentWeek) ? (d.weeklyXP || 0) : 0;
                        const xpt  = (d.xpTodayDate  === todayStr)    ? (d.xpToday  || 0) : 0;
                        const xph  = (d.xpPerHourDate === yesterdayStr) ? (d.xpPerHour || 0) : 0;
                        const entry = { uid, ...d, weeklyXP: wXP, xpToday: xpt, xpPerHour: xph, isMe: false };
                        window._friendProfileCache[uid] = entry;
                        return entry;
                    } catch(e) { return null; }
                });
                const results = await Promise.all(fetches);
                results.forEach(r => { if (r) entries.push(r); });
            }

            // ── 4. Pending requests banner ─────────────────────────────────
            let requestsHTML = '';
            if (pendingRequests.length > 0) {
                requestsHTML = `
                <div style="margin-bottom:4px;">
                    <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--color-accent-blue);margin-bottom:12px;padding-top:4px;">
                        Friend Requests (${pendingRequests.length})
                    </div>
                    ${pendingRequests.map(r => {
                        const alreadyFriend = (window.userData.friends || []).includes(r.fromUID);
                        const av = r.fromPhotoURL
                            ? `<img src="${escapeHtml(r.fromPhotoURL)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;">`
                            : `<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--color-accent-blue),var(--color-progress));display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0;">${escapeHtml((r.fromName||'?')[0].toUpperCase())}</div>`;
                        return `
                        <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:rgba(93,156,236,0.06);border:1px solid rgba(93,156,236,0.25);border-radius:12px;margin-bottom:8px;">
                            ${av}
                            <div style="flex:1;min-width:0;">
                                <div style="font-size:13px;font-weight:700;color:var(--color-text-primary);">${escapeHtml(r.fromName||'Someone')}</div>
                                <div style="font-size:11px;color:var(--color-text-secondary);">added you as a friend</div>
                            </div>
                            <div style="display:flex;gap:6px;flex-shrink:0;">
                                ${alreadyFriend
                                    ? `<button onclick="dismissFriendRequest('${escapeHtml(r.docId)}')" style="background:none;border:1px solid var(--color-border);color:var(--color-text-secondary);border-radius:8px;padding:6px 10px;font-size:11px;cursor:pointer;font-family:inherit;">Dismiss</button>`
                                    : `<button onclick="acceptFriendRequest('${escapeHtml(r.fromUID)}','${escapeHtml(r.fromCode||'')}','${escapeHtml(r.docId)}')" style="background:var(--color-accent-blue);border:none;color:#fff;border-radius:8px;padding:6px 12px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;">Add Back</button>
                                       <button onclick="dismissFriendRequest('${escapeHtml(r.docId)}')" style="background:none;border:1px solid var(--color-border);color:var(--color-text-secondary);border-radius:8px;padding:6px 10px;font-size:11px;cursor:pointer;font-family:inherit;">Dismiss</button>`
                                }
                            </div>
                        </div>`;
                    }).join('')}
                </div>`;
            }

            // ── 5. Leaderboard — with metric selector + custom hidden list ──
            const metric        = (window.userData.settings || {}).leaderboardMetric || 'weeklyXP';
            const hiddenUIDs    = new Set(window.userData.leaderboardHidden || []);
            // Always include self; filter out hidden friends (still show them in Friends list)
            const lbEntries     = entries.filter(e => e.isMe || !hiddenUIDs.has(e.uid));
            const metricVal     = e => {
                if (metric === 'xpPerHour') return e.xpPerHour || 0;
                if (metric === 'xpToday')   return e.xpToday   || 0;
                return e.weeklyXP || 0;
            };
            const metricLabel   = metric === 'xpPerHour' ? 'XP / Hour'
                                : metric === 'xpToday'   ? 'XP Today'
                                : 'This Week';
            const metricSubLabel = metric === 'xpPerHour' ? 'XP/hr (yesterday)'
                                 : metric === 'xpToday'   ? 'XP today'
                                 : 'XP this week';
            const sorted        = [...lbEntries].sort((a, b) => metricVal(b) - metricVal(a));
            const topEntries    = sorted.slice(0, 10);
            const medals        = ['\ud83e\udd47', '\ud83e\udd48', '\ud83e\udd49'];

            lb.innerHTML = requestsHTML + `
                <!-- Metric selector -->
                <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;">
                    <button class="filter-pill${metric==='weeklyXP'?' active':''}"
                        onclick="setLeaderboardMetric('weeklyXP')">📅 XP This Week</button>
                    <button class="filter-pill${metric==='xpPerHour'?' active':''}"
                        onclick="setLeaderboardMetric('xpPerHour')">⚡ XP / Hour</button>
                    <button class="filter-pill${metric==='xpToday'?' active':''}"
                        onclick="setLeaderboardMetric('xpToday')">🌟 XP Today</button>
                </div>
                <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--color-text-secondary);margin-bottom:12px;">${metricLabel}</div>
                ${topEntries.length === 0 ? '<div style="padding:20px 0;text-align:center;color:var(--color-text-secondary);font-size:13px;">No one on the leaderboard yet.</div>' :
                topEntries.map((e, i) => {
                    const rank      = i + 1;
                    const rankBadge = rank <= 3
                        ? medals[rank - 1]
                        : `<span style="font-size:12px;font-weight:700;color:var(--color-text-secondary);min-width:20px;text-align:center;">${rank}</span>`;
                    const isMe   = e.isMe;
                    const avatar = e.photoURL
                        ? `<img src="${escapeHtml(e.photoURL)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">`
                        : `<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--color-accent-blue),var(--color-progress));display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0;">${escapeHtml((e.displayName||'?')[0].toUpperCase())}</div>`;
                    return `
                    <div onclick="openFriendProfileCard('${escapeHtml(e.uid)}')"
                         style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:${isMe ? 'rgba(93,156,236,0.08)' : 'var(--color-bg-card)'};border:1px solid ${isMe ? 'var(--color-accent-blue)' : 'var(--color-border)'};border-radius:12px;margin-bottom:6px;cursor:pointer;">
                        <div style="width:24px;display:flex;justify-content:center;flex-shrink:0;">${rankBadge}</div>
                        ${avatar}
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:13px;font-weight:700;color:var(--color-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(e.displayName || 'Adventurer')}${isMe ? ' <span style="font-size:10px;color:var(--color-accent-blue);font-weight:600;">YOU</span>' : ''}</div>
                            <div style="font-size:11px;color:var(--color-text-secondary);">Lv ${e.level || 1} \u00b7 ${escapeHtml(e.characterTitle || '')}</div>
                        </div>
                        <div style="text-align:right;flex-shrink:0;">
                            <div style="font-size:14px;font-weight:700;color:var(--color-progress);">${metricVal(e).toLocaleString()}</div>
                            <div style="font-size:10px;color:var(--color-text-secondary);">${metricSubLabel}</div>
                        </div>
                    </div>`;
                }).join('')}</div>`;

            // ── 6. Add Friend input ────────────────────────────────────────
            const atCap = friends.length >= 20;
            add.innerHTML = `
                <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--color-text-secondary);margin-bottom:12px;margin-top:24px;">Add a Friend</div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <input id="friendCodeInput" type="text" maxlength="7" placeholder="MK-XXXX"
                        ${atCap ? 'disabled' : ''}
                        style="flex:1;background:var(--color-bg-card);border:1px solid var(--color-border);border-radius:10px;padding:10px 14px;font-size:14px;font-weight:600;color:var(--color-text-primary);font-family:inherit;letter-spacing:0.05em;text-transform:uppercase;outline:none;opacity:${atCap ? '0.5' : '1'};"
                        oninput="this.value=this.value.toUpperCase()" onkeydown="if(event.key==='Enter')addFriendByCode()">
                    <button onclick="addFriendByCode()" ${atCap ? 'disabled' : ''} style="background:var(--color-accent-blue);color:#fff;border:none;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;opacity:${atCap ? '0.5' : '1'};">Add</button>
                </div>
                <div id="friendAddStatus" style="font-size:12px;margin-top:8px;min-height:18px;color:var(--color-text-secondary);">
                    ${atCap ? 'Friend limit reached (20 max). Remove a friend to add someone new.' : ''}
                </div>`;

            // ── 7. All Friends list ────────────────────────────────────────
            const friendEntries = entries.filter(e => !e.isMe);
            if (friendEntries.length === 0) {
                all.innerHTML = `
                    <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--color-text-secondary);margin-bottom:12px;margin-top:24px;">Friends (0)</div>
                    <div style="padding:20px 0;text-align:center;color:var(--color-text-secondary);font-size:13px;">Add a friend using their MK code above \u2191</div>`;
            } else {
                all.innerHTML = `
                    <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--color-text-secondary);margin-bottom:12px;margin-top:24px;">Friends (${friendEntries.length}/20)</div>
                    ${friendEntries.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '')).map(e => {
                        const avatar = e.photoURL
                            ? `<img src="${escapeHtml(e.photoURL)}" style="width:38px;height:38px;border-radius:50%;object-fit:cover;">`
                            : `<div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--color-accent-blue),var(--color-progress));display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:#fff;flex-shrink:0;">${escapeHtml((e.displayName || '?')[0].toUpperCase())}</div>`;
                        return `
                        <div onclick="openFriendProfileCard('${escapeHtml(e.uid)}')"
                             style="display:flex;align-items:center;gap:12px;padding:11px 14px;background:var(--color-bg-card);border:1px solid var(--color-border);border-radius:12px;margin-bottom:6px;cursor:pointer;">
                            ${avatar}
                            <div style="flex:1;min-width:0;">
                                <div style="font-size:14px;font-weight:700;color:var(--color-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(e.displayName || 'Adventurer')}</div>
                                <div style="font-size:11px;color:var(--color-text-secondary);">Lv ${e.level || 1} \u00b7 ${escapeHtml(e.characterTitle || '')}</div>
                            </div>
                            <div style="font-size:11px;color:var(--color-text-secondary);flex-shrink:0;">\u203a</div>
                        </div>`;
                    }).join('')}`;
            }
        };

        // ── Add friend by MK code ─────────────────────────────────────────
        window.addFriendByCode = async function() {
            const input  = document.getElementById('friendCodeInput');
            const status = document.getElementById('friendAddStatus');
            if (!input || !status) return;
            const code = input.value.trim().toUpperCase();
            if (!code || code.length < 5) { status.textContent = 'Enter a valid MK-XXXX code.'; return; }

            // Hard cap: 20 friends max
            const friends = window.userData.friends || [];
            if (friends.length >= 20) {
                status.textContent = 'You’ve reached the 20 friend limit.';
                return;
            }

            status.textContent = 'Searching…';
            try {
                const q    = query(collection(db, 'publicProfiles'), where('friendCode', '==', code));
                const snap = await getDocs(q);
                if (snap.empty) { status.textContent = '✗ No user found with that code.'; return; }

                const friendDoc  = snap.docs[0];
                const friendUID  = friendDoc.id;
                const friendData = friendDoc.data();

                if (friendUID === window.currentUser.uid) {
                    status.textContent = "That’s your own code 😄";
                    return;
                }
                if (friends.includes(friendUID)) {
                    status.textContent = `${friendData.displayName || 'This person'} is already your friend.`;
                    return;
                }

                // Add to own friends list
                window.userData.friends = [...friends, friendUID];
                await saveUserData();

                // Notify the other user — deterministic doc ID prevents duplicates
                try {
                    const me = window.currentUser;
                    const myName = (window.userData.profile && window.userData.profile.username)
                        || me.displayName || 'Someone';
                    const reqRef = doc(db, 'friendRequests', `${friendUID}_${me.uid}`);
                    await setDoc(reqRef, {
                        toUID:        friendUID,
                        fromUID:      me.uid,
                        fromName:     myName,
                        fromPhotoURL: me.photoURL || null,
                        fromCode:     window.userData.friendCode || null,
                        createdAt:    new Date().toISOString()
                    });
                } catch(reqErr) {
                    console.warn('Friend request notify failed (non-critical):', reqErr);
                }

                input.value = '';
                status.textContent = `✓ ${friendData.displayName || 'Friend'} added!`;
                renderFriendsTab();
            } catch(e) {
                console.error('addFriendByCode error:', e);
                status.textContent = 'Something went wrong. Try again.';
            }
        };

        // ── Open read-only friend profile card (bottom sheet) ────────────
        window.openFriendProfileCard = function(uid) {
            const data = window._friendProfileCache[uid];
            if (!data) return;
            const overlay = document.getElementById('friendProfileOverlay');
            if (!overlay) return;

            const isMe  = data.isMe;
            const catXP = data.categoryXP || {};
            const cats  = window.LIFE_CATEGORIES;

            const totalFriendCatXP = Math.max(1, cats.reduce((s, c) => s + (catXP[c.id] || 0), 0));
            const W = 200, H = 200, cx = W/2, cy = H/2, r = 78;
            const angleStep = (2 * Math.PI) / cats.length;
            const F_BASE = 0.4, F_FLOOR = 0.05;
            const fSpiderR = (xp) => {
                if (xp <= 0) return r * F_FLOOR;
                return r * (F_BASE + (1 - F_BASE) * (xp / totalFriendCatXP));
            };
            const polygon   = cats.map((c, i) => {
                const rad   = fSpiderR(catXP[c.id] || 0);
                const angle = -Math.PI / 2 + i * angleStep;
                return [cx + rad * Math.cos(angle), cy + rad * Math.sin(angle)];
            });
            const gridLevels = [0.25, 0.5, 0.75, 1];
            const gridSVG = gridLevels.map(pct =>
                `<polygon points="${cats.map((_,i) => {
                    const a = -Math.PI/2 + i * angleStep;
                    return `${cx + r*pct*Math.cos(a)},${cy + r*pct*Math.sin(a)}`;
                }).join(' ')}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>`
            ).join('');
            const axesSVG = cats.map((_,i) => {
                const a = -Math.PI/2 + i * angleStep;
                return `<line x1="${cx}" y1="${cy}" x2="${cx+r*Math.cos(a)}" y2="${cy+r*Math.sin(a)}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>`;
            }).join('');
            const polyPoints = polygon.map(p => p.join(',')).join(' ');
            const labelsSVG  = cats.map((c, i) => {
                const a  = -Math.PI/2 + i * angleStep;
                const lx = cx + (r + 18) * Math.cos(a), ly = cy + (r + 18) * Math.sin(a);
                return `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="9" fill="var(--color-text-secondary)" font-family="inherit">${c.label}</text>`;
            }).join('');
            const spiderSVG = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:200px;">
                ${gridSVG}${axesSVG}
                <polygon points="${polyPoints}" fill="rgba(93,156,236,0.18)" stroke="var(--color-accent-blue)" stroke-width="1.5"/>
                ${labelsSVG}
            </svg>`;

            const avatar = data.photoURL
                ? `<img src="${escapeHtml(data.photoURL)}" style="width:60px;height:60px;border-radius:50%;object-fit:cover;border:2px solid var(--color-border);">`
                : `<div style="width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,var(--color-accent-blue),var(--color-progress));display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#fff;flex-shrink:0;">${escapeHtml((data.displayName||'?')[0].toUpperCase())}</div>`;

            const currentWeek = getISOWeekLabel();
            const wXP  = (data.weeklyXPWeek === currentWeek) ? (data.weeklyXP || 0) : 0;
            const xphr = data.isMe
                ? computeXPPerHour((() => { const a = []; (window.userData.dimensions||[]).forEach(d=>(d.paths||[]).forEach(p=>(p.activities||[]).forEach(x=>a.push(x)))); return a; })())
                : (data.xpPerHour || 0);

            document.getElementById('friendProfileContent').innerHTML = `
                <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px;">
                    ${avatar}
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--color-text-secondary);margin-bottom:3px;">${escapeHtml(data.characterTitle || '')}</div>
                        <div style="font-size:20px;font-weight:800;color:var(--color-text-primary);letter-spacing:-0.02em;">${escapeHtml(data.displayName || 'Adventurer')}</div>
                        <div style="font-size:11px;color:var(--color-text-secondary);margin-top:3px;">Level ${data.level || 1}</div>
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;">
                    ${[
                        { val: (data.totalXP||0).toLocaleString(), lbl: 'Total XP' },
                        { val: wXP.toLocaleString(),               lbl: 'This Week' },
                        { val: xphr.toLocaleString(),              lbl: 'XP / Hour' },
                        { val: data.bestStreak || 0,               lbl: 'Best Streak' },
                        { val: data.activeDays || 0,               lbl: 'Active Days' },
                        { val: escapeHtml(data.characterTitle||'-'), lbl: 'Title' },
                    ].map(t => `<div style="background:var(--color-bg-primary);border:1px solid var(--color-border);border-radius:10px;padding:10px 8px;text-align:center;">
                        <div style="font-size:13px;font-weight:700;color:var(--color-text-primary);word-break:break-word;">${t.val}</div>
                        <div style="font-size:10px;color:var(--color-text-secondary);margin-top:2px;">${t.lbl}</div>
                    </div>`).join('')}
                </div>
                <div style="display:flex;justify-content:center;margin-bottom:8px;">${spiderSVG}</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-bottom:16px;">
                    ${cats.map(c => `<div style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--color-text-secondary);">
                        <span style="width:8px;height:8px;border-radius:50%;background:${c.color};display:inline-block;"></span>${c.label}
                    </div>`).join('')}
                </div>
                ${!isMe ? `
                <div style="display:flex;gap:8px;margin-top:4px;">
                    <button onclick="toggleLeaderboardVisibility('${escapeHtml(uid)}')"
                        style="flex:1;background:none;border:1px solid var(--color-border);color:var(--color-text-secondary);border-radius:10px;padding:10px;font-size:12px;cursor:pointer;font-family:inherit;text-align:center;">
                        ${(window.userData.leaderboardHidden || []).includes(uid) ? '➕ Add to Leaderboard' : '🚫 Remove from Leaderboard'}
                    </button>
                    <button onclick="removeFriend('${escapeHtml(uid)}')"
                        style="flex:1;background:none;border:1px solid var(--color-border);color:var(--color-text-secondary);border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-family:inherit;text-align:center;">
                        Remove Friend
                    </button>
                </div>` : ''}`;

            overlay.style.display = 'flex';
        };

        window.closeFriendProfileCard = function() {
            const overlay = document.getElementById('friendProfileOverlay');
            if (overlay) overlay.style.display = 'none';
        };

        // ── Remove a friend ───────────────────────────────────────────────
        window.removeFriend = async function(uid) {
            if (!confirm('Remove this friend?')) return;
            window.userData.friends = (window.userData.friends || []).filter(id => id !== uid);
            // Also remove from leaderboard hidden if present
            window.userData.leaderboardHidden = (window.userData.leaderboardHidden || []).filter(id => id !== uid);
            await saveUserData();
            closeFriendProfileCard();
            renderFriendsTab();
        };

        // ── Leaderboard metric selector ───────────────────────────────────
        window.setLeaderboardMetric = function(metric) {
            if (!window.userData.settings) window.userData.settings = {};
            window.userData.settings.leaderboardMetric = metric;
            debouncedSaveUserData(); // persist preference non-blocking
            renderFriendsTab();     // re-render with new sort
        };

        // ── Remove / Add to leaderboard (custom leaderboard) ─────────────
        // Excluded friends stay in the Friends list but are skipped in rankings.
        window.toggleLeaderboardVisibility = function(uid) {
            const hidden = window.userData.leaderboardHidden || [];
            const isHidden = hidden.includes(uid);
            window.userData.leaderboardHidden = isHidden
                ? hidden.filter(id => id !== uid)
                : [...hidden, uid];
            debouncedSaveUserData();
            closeFriendProfileCard();
            renderFriendsTab();
        };

        // ── Accept a friend request ───────────────────────────────────────
        window.acceptFriendRequest = async function(fromUID, fromCode, docId) {
            const friends = window.userData.friends || [];
            if (!friends.includes(fromUID) && friends.length < 20) {
                window.userData.friends = [...friends, fromUID];
                await saveUserData();
            }
            try {
                const { deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
                await deleteDoc(doc(db, 'friendRequests', docId));
            } catch(e) { console.warn('Could not delete friend request:', e); }
            renderFriendsTab();
        };

        // ── Dismiss a friend request ──────────────────────────────────────
        window.dismissFriendRequest = async function(docId) {
            try {
                const { deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
                await deleteDoc(doc(db, 'friendRequests', docId));
            } catch(e) { console.warn('Could not dismiss friend request:', e); }
            renderFriendsTab();
        };

        // ── Copy friend code ──────────────────────────────────────────────
        window.copyFriendCode = function() {
            const code = window.userData && window.userData.friendCode;
            if (!code) return;
            navigator.clipboard.writeText(code).then(() => {
                showToast('Friend code copied!', 'blue');
            }).catch(() => showToast(code, 'blue'));
        };

        // ── Share via native share sheet or clipboard fallback ────────────
        window.shareFriendCode = async function() {
            const code = window.userData && window.userData.friendCode;
            if (!code) return;
            const url  = `${window.location.origin}${window.location.pathname}?add=${code}`;
            const text = `Add me on Mindkraft! Use code ${code} or tap the link:`;
            if (navigator.share) {
                try { await navigator.share({ title: 'Add me on Mindkraft', text, url }); return; }
                catch(e) { if (e.name === 'AbortError') return; }
            }
            try {
                await navigator.clipboard.writeText(`${text}\n${url}`);
                showToast('Link copied to clipboard', 'blue');
            } catch(e) { showToast(url, 'blue'); }
        };

        // ── Deep-link (?add=MK-XXXX on login) ────────────────────────────
        function handleFriendDeepLink() {
            try {
                const params = new URLSearchParams(window.location.search);
                const code   = params.get('add');
                if (!code) return;
                window.history.replaceState({}, '', window.location.pathname);
                switchTab('friends');
                setTimeout(() => {
                    const input = document.getElementById('friendCodeInput');
                    if (input) { input.value = code.toUpperCase(); addFriendByCode(); }
                }, 600);
            } catch(e) { console.warn('Deep link handling failed:', e); }
        }


        // ════════════════════════════════════════════════════════
        //  GROUP CHALLENGE MODULE
        // ════════════════════════════════════════════════════════


        // ════════════════════════════════════════════════════════
        //  GROUP CHALLENGE MODULE  (v2 — multi-nomination)
        // ════════════════════════════════════════════════════════

        const GC_COL      = 'groupChallenges';
        const GC_CODES    = 'groupInviteCodes';
        const GC_INVITES  = 'groupInvitations';
        const GC_MAX_NOMS = 3;

        // ── Helpers ───────────────────────────────────────────────────────

        function gcGenerateCode() {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            return Array.from({length: 6}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        }

        function gcFmtDate(dateStr) {
            if (!dateStr) return '';
            const d = new Date(dateStr + 'T00:00:00');
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        }

        function gcDaysLeft(endDate) {
            return Math.max(0, Math.ceil((new Date(endDate + 'T00:00:00') - new Date()) / 86400000));
        }

        function gcGetActiveGroupId() { return window.userData?.activeGroupChallengeId || null; }

        // Migrate old single-nomination to nominations array for backward compat
        function gcNormaliseNominations(member) {
            if (member.nominations && member.nominations.length > 0) return member.nominations;
            if (member.nominatedChallengeId) {
                return [{
                    challengeId:   member.nominatedChallengeId,
                    challengeName: member.nominatedChallengeName || 'Challenge',
                    challengeTarget:  member.challengeTarget  || 0,
                    challengeCurrent: member.challengeCurrent || 0,
                    challengeStatus:  member.challengeStatus  || 'active',
                    metricEnabled: false,
                    metricQty: null, metricUnit: null, metricCurrent: 0,
                }];
            }
            return [];
        }

        // Compute momentum: % of active members who logged today or yesterday
        function gcComputeMomentum(activeMembers) {
            const today = localToday();
            const yday  = localYesterday();
            if (!activeMembers.length) return 0;
            const recent = activeMembers.filter(m => m.lastActiveDate === today || m.lastActiveDate === yday).length;
            return Math.round((recent / activeMembers.length) * 100);
        }

        // ── Main tab renderer ─────────────────────────────────────────────

        window.renderGroupChallengeTab = async function() {
            const container = document.getElementById('groupChallengeContent');
            if (!container) return;
            container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--color-text-secondary);font-size:13px;">Loading…</div>';

            const myUID = window.currentUser?.uid;
            if (!myUID) return;

            // Load pending invitations
            let pendingInvites = [];
            try {
                const q = query(collection(db, GC_INVITES),
                    where('inviteeUid', '==', myUID),
                    where('status', '==', 'pending'));
                const snap = await getDocs(q);
                snap.forEach(d => pendingInvites.push({ docId: d.id, ...d.data() }));
            } catch(e) { console.warn('GC invitations fetch failed:', e); }

            // Handle ?joinGroup= deep link
            try {
                const params = new URLSearchParams(window.location.search);
                const code = params.get('joinGroup');
                if (code) {
                    window.history.replaceState({}, '', window.location.pathname);
                    const codeSnap = await getDoc(doc(db, GC_CODES, code.toUpperCase()));
                    if (codeSnap.exists()) {
                        const { groupId } = codeSnap.data();
                        const groupSnap = await getDoc(doc(db, GC_COL, groupId));
                        if (groupSnap.exists()) {
                            const group = { id: groupSnap.id, ...groupSnap.data() };
                            const alreadyInvited = pendingInvites.some(i => i.groupId === groupId);
                            const alreadyMember  = !!(group.members?.[myUID]?.status === 'active');
                            if (!alreadyInvited && !alreadyMember) {
                                pendingInvites.unshift({ docId: null, groupId, groupName: group.name, inviterName: 'via invite link', inviterUid: group.creatorUid });
                            }
                        }
                    }
                }
            } catch(e) { console.warn('GC deep link resolve failed:', e); }

            const activeGroupId = gcGetActiveGroupId();
            if (activeGroupId) {
                try {
                    const groupSnap = await getDoc(doc(db, GC_COL, activeGroupId));
                    if (groupSnap.exists()) {
                        gcRenderDashboard(container, { id: groupSnap.id, ...groupSnap.data() }, myUID, pendingInvites);
                    } else {
                        window.userData.activeGroupChallengeId = null;
                        await saveUserData();
                        gcRenderEmpty(container, pendingInvites);
                    }
                } catch(e) {
                    container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--color-text-secondary);">Failed to load. Check your connection.</div>';
                }
            } else {
                gcRenderEmpty(container, pendingInvites);
            }
        };

        // ── Empty state ───────────────────────────────────────────────────

        function gcRenderEmpty(container, pendingInvites) {
            const inviteCards = pendingInvites.map(inv => `
                <div class="gc-invite-card">
                    <div class="gc-invite-icon">🏆</div>
                    <div class="gc-invite-body">
                        <div class="gc-invite-title">${escapeHtml(inv.groupName || 'Group Challenge')}</div>
                        <div class="gc-invite-sub">Invited by ${escapeHtml(inv.inviterName || 'someone')}</div>
                    </div>
                    <div class="gc-invite-actions">
                        <button class="btn-accept" onclick="gcAcceptInvite('${inv.groupId}','${inv.docId || ''}')">Accept</button>
                        <button class="btn-decline" onclick="gcDeclineInvite('${inv.docId || ''}','${inv.groupId}')">Decline</button>
                    </div>
                </div>`).join('');

            container.innerHTML = `
                ${inviteCards}
                <div class="gc-empty">
                    <div class="gc-empty-icon">🏆</div>
                    <div class="gc-empty-title">No Active Group Challenge</div>
                    <div class="gc-empty-sub">Team up with friends and tackle your goals together. Each person brings their own challenges.</div>
                    <div class="gc-empty-actions">
                        <button class="btn-primary-full" onclick="openCreateGroupModal()">＋ Create Group Challenge</button>
                        <button class="btn-secondary-full" onclick="openGroupJoinModal()">🔗 Join with Invite Code</button>
                    </div>
                </div>`;
        }

        // ── Dashboard ─────────────────────────────────────────────────────

        function gcRenderDashboard(container, group, myUID, pendingInvites = []) {
            const members       = group.members || {};
            const activeMembers = Object.values(members).filter(m => m.status === 'active');
            const today         = localToday();
            const isCreator     = group.creatorUid === myUID;
            const myMember      = members[myUID];

            // Aggregate group progress across all nominations from all members
            let totalPct = 0, nomCount = 0;
            activeMembers.forEach(m => {
                gcNormaliseNominations(m).forEach(n => {
                    const pct = n.metricEnabled && n.metricQty > 0
                        ? Math.min(100, ((n.metricCurrent || 0) / n.metricQty) * 100)
                        : (n.challengeTarget > 0 ? Math.min(100, (n.challengeCurrent / n.challengeTarget) * 100) : 0);
                    totalPct += pct; nomCount++;
                });
            });
            const aggPct = nomCount > 0 ? Math.round(totalPct / nomCount) : 0;

            // Momentum
            const momentum = gcComputeMomentum(activeMembers);

            // Active today avatars
            const activeTodayMembers = activeMembers.filter(m => m.lastActiveDate === today);

            // Invite cards
            const inviteCards = pendingInvites.map(inv => `
                <div class="gc-invite-card">
                    <div class="gc-invite-icon">🏆</div>
                    <div class="gc-invite-body">
                        <div class="gc-invite-title">${escapeHtml(inv.groupName || 'Group Challenge')}</div>
                        <div class="gc-invite-sub">Invited by ${escapeHtml(inv.inviterName || 'someone')}</div>
                    </div>
                    <div class="gc-invite-actions">
                        <button class="btn-accept" onclick="gcAcceptInvite('${inv.groupId}','${inv.docId || ''}')">Accept</button>
                        <button class="btn-decline" onclick="gcDeclineInvite('${inv.docId || ''}','${inv.groupId}')">Decline</button>
                    </div>
                </div>`).join('');

            // Member cards (full width, stacked)
            const memberCards = activeMembers.map(m => gcRenderMemberCard(m, myUID, isCreator, group, today)).join('');

            // Active today avatar strip
            const activeTodayStrip = activeTodayMembers.length > 0 ? `
                <div class="gc-active-strip">
                    <span class="gc-active-strip-label">Active today</span>
                    <div class="gc-active-avatars">
                        ${activeTodayMembers.map(m => {
                            const initial = (m.displayName || '?')[0].toUpperCase();
                            return m.photoURL
                                ? `<img class="gc-active-avatar" src="${escapeHtml(m.photoURL)}" title="${escapeHtml(m.displayName || '')}">`
                                : `<div class="gc-active-avatar gc-active-avatar-initial" title="${escapeHtml(m.displayName || '')}">${initial}</div>`;
                        }).join('')}
                        <span class="gc-active-count">${activeTodayMembers.length}/${activeMembers.length}</span>
                    </div>
                </div>` : `<div class="gc-active-strip"><span class="gc-active-strip-label" style="opacity:0.5;">No activity logged today yet</span></div>`;

            // Momentum bar colour
            const momentumColor = momentum >= 70 ? '#4caf82' : momentum >= 40 ? '#e0b450' : '#e07070';
            const momentumLabel = momentum >= 70 ? 'Strong momentum 🔥' : momentum >= 40 ? 'Building momentum' : 'Needs a push ⚡';

            container.innerHTML = `
                ${inviteCards}
                <div class="gc-dashboard">

                    <!-- Header -->
                    <div class="gc-header">
                        <div class="gc-header-top">
                            <div>
                                <div class="gc-group-name">🏆 ${escapeHtml(group.name)}</div>
                                <div class="gc-date-range">${gcFmtDate(group.startDate)} → ${gcFmtDate(group.endDate)} · ${gcDaysLeft(group.endDate)}d left</div>
                            </div>
                            <div class="gc-header-actions">
                                ${isCreator ? `<button class="gc-icon-btn" onclick="openEditGroupModal()" title="Edit group">✏️</button>` : ''}
                                ${isCreator ? `<button class="gc-icon-btn danger" onclick="gcDeleteGroupConfirm('${group.id}')" title="Delete group">🗑️</button>` : ''}
                                <button class="gc-icon-btn" onclick="openGroupInviteModal('${group.id}')" title="Invite members">👥</button>
                                <button class="gc-icon-btn danger" onclick="gcConfirmExit('${group.id}')" title="Exit group">🚪</button>
                            </div>
                        </div>
                        ${group.description ? `<div class="gc-description">${escapeHtml(group.description)}</div>` : ''}
                    </div>

                    <!-- Progress + Momentum -->
                    <div class="gc-progress-section">
                        <div class="gc-progress-label">
                            <span>Group Progress</span>
                            <span class="gc-progress-pct-large">${aggPct}%</span>
                        </div>
                        <div class="gc-agg-progress-bar">
                            <div class="gc-agg-progress-fill" style="width:${aggPct}%"></div>
                        </div>
                        <!-- Momentum -->
                        <div class="gc-momentum-row">
                            <div class="gc-momentum-bar-wrap">
                                <div class="gc-momentum-fill" style="width:${momentum}%;background:${momentumColor};box-shadow:0 0 6px ${momentumColor}55;"></div>
                            </div>
                            <span class="gc-momentum-label" style="color:${momentumColor};">${momentumLabel}</span>
                        </div>
                        ${activeTodayStrip}
                    </div>

                    <!-- Invite code -->
                    <div class="gc-code-row">
                        <span class="gc-code-label">Invite Code</span>
                        <span class="gc-code-value">${group.inviteCode || ''}</span>
                        <button class="gc-code-copy" onclick="gcCopyCode('${group.inviteCode}')">Copy</button>
                    </div>

                    <!-- Member cards -->
                    <div class="gc-members-list">${memberCards}</div>
                </div>`;
        }

        function gcRenderMemberCard(m, myUID, isCreator, group, today) {
            const isMe    = m.uid === myUID;
            const noms    = gcNormaliseNominations(m);
            const hasNoms = noms.length > 0;
            const initial = (m.displayName || '?')[0].toUpperCase();

            const daysAgo = m.lastActiveDate
                ? Math.max(0, Math.floor((new Date(today) - new Date(m.lastActiveDate)) / 86400000)) : null;
            const activeToday = m.lastActiveDate === today;
            const isLagging   = daysAgo !== null && daysAgo >= 3 && hasNoms;
            const allDone     = hasNoms && noms.every(n => n.challengeStatus === 'completed');

            const statusLabel = activeToday ? 'Active today'
                : daysAgo === 1 ? 'Yesterday'
                : daysAgo !== null && daysAgo > 1 ? `${daysAgo}d ago`
                : 'Not started';

            const isLeader = group.creatorUid === m.uid;

            // Nomination rows
            const nomRows = hasNoms ? noms.map(n => {
                const isDone = n.challengeStatus === 'completed';
                let pct, barLabel;
                if (n.metricEnabled && n.metricQty > 0) {
                    pct = Math.min(100, Math.round(((n.metricCurrent || 0) / n.metricQty) * 100));
                    barLabel = `${n.metricCurrent || 0} / ${n.metricQty} ${escapeHtml(n.metricUnit || '')}`;
                } else {
                    pct = n.challengeTarget > 0 ? Math.min(100, Math.round((n.challengeCurrent / n.challengeTarget) * 100)) : 0;
                    barLabel = `${n.challengeCurrent || 0} / ${n.challengeTarget || 0} completed`;
                }
                return `
                    <div class="gc-nom-row">
                        <div class="gc-nom-name">${escapeHtml(n.challengeName)}</div>
                        <div class="gc-nom-bar-wrap">
                            <div class="gc-nom-bar">
                                <div class="gc-nom-fill ${isDone ? 'done' : ''}" style="width:${pct}%"></div>
                            </div>
                            <span class="gc-nom-pct">${pct}%</span>
                        </div>
                        <div class="gc-nom-meta">${barLabel}${isDone ? ' · <span style="color:#4caf82;font-weight:700;">✓ Done</span>' : ''}</div>
                    </div>`;
            }).join('') : '';

            // Card border/glow state
            const cardClass = allDone ? 'gc-member-card gc-card-done'
                : isLagging ? 'gc-member-card gc-card-lagging'
                : activeToday ? 'gc-member-card gc-card-active'
                : 'gc-member-card';

            return `
                <div class="${cardClass}">
                    <!-- Top row: avatar + identity + status -->
                    <div class="gc-card-top">
                        <div class="gc-avatar-wrap">
                            ${m.photoURL
                                ? `<img class="gc-avatar" src="${escapeHtml(m.photoURL)}" alt="">`
                                : `<div class="gc-avatar-initials">${initial}</div>`}
                            ${activeToday ? '<span class="gc-status-dot active-today"></span>' : ''}
                            ${isLagging && !activeToday ? '<span class="gc-status-dot lagging"></span>' : ''}
                        </div>
                        <div class="gc-card-identity">
                            <div class="gc-member-name">
                                ${escapeHtml(m.displayName || 'Unknown')}
                                ${isMe ? '<span class="gc-you-badge">you</span>' : ''}
                                ${isLeader ? '<span class="gc-leader-badge">👑</span>' : ''}
                            </div>
                            <div class="gc-member-meta">Lv ${m.level || 1} · ${statusLabel}</div>
                        </div>
                        <div class="gc-card-status">
                            ${allDone ? '<span class="gc-done-chip">✓ All done</span>' : ''}
                            ${isLagging && !allDone ? '<span class="gc-lagging-chip">⚠ Inactive</span>' : ''}
                        </div>
                    </div>

                    <!-- Nomination rows -->
                    ${hasNoms
                        ? `<div class="gc-noms">${nomRows}</div>`
                        : `<div class="gc-no-noms">No challenges nominated yet</div>`}

                    <!-- Actions -->
                    <div class="gc-card-actions">
                        ${isMe && noms.length < GC_MAX_NOMS ? `<button class="gc-nominate-btn" onclick="openGroupNominateModal()">＋ Add Challenge</button>` : ''}
                        ${isMe && hasNoms ? `<button class="gc-edit-btn" onclick="openGroupNominateModal()">Manage</button>` : ''}
                        ${isCreator && !isMe ? `<button class="gc-remove-btn" onclick="gcRemoveMember('${group.id}','${m.uid}')">Remove</button>` : ''}
                    </div>
                </div>`;
        }

        // ── Create / Edit Group ───────────────────────────────────────────

        let _gcEditingGroupId = null;

        window.openCreateGroupModal = function() {
            _gcEditingGroupId = null;
            document.getElementById('groupCreateModalTitle').textContent = 'Create Group Challenge';
            document.getElementById('groupCreateSubmitBtn').textContent  = 'Create Group Challenge';
            document.getElementById('groupCreateForm').reset();
            const today = localToday();
            const end   = new Date(); end.setMonth(end.getMonth() + 3);
            document.getElementById('groupStartDate').value = today;
            document.getElementById('groupEndDate').value   = toLocalDateStr(end);
            document.getElementById('groupCreateModal').classList.add('active');
        };

        window.openEditGroupModal = async function() {
            const groupId = gcGetActiveGroupId();
            if (!groupId) return;
            try {
                const snap = await getDoc(doc(db, GC_COL, groupId));
                if (!snap.exists()) return;
                const g = snap.data();
                _gcEditingGroupId = groupId;
                document.getElementById('groupCreateModalTitle').textContent = 'Edit Group Challenge';
                document.getElementById('groupCreateSubmitBtn').textContent  = 'Save Changes';
                document.getElementById('groupName').value        = g.name || '';
                document.getElementById('groupDescription').value = g.description || '';
                document.getElementById('groupStartDate').value   = g.startDate || '';
                document.getElementById('groupEndDate').value     = g.endDate   || '';
                document.getElementById('groupCreateModal').classList.add('active');
            } catch(e) { showToast('Failed to load group details.', 'red'); }
        };

        window.closeGroupCreateModal = function() {
            document.getElementById('groupCreateModal').classList.remove('active');
        };

        window.saveGroupChallenge = async function(event) {
            event.preventDefault();
            const myUID = window.currentUser?.uid;
            if (!myUID) return;
            const name        = document.getElementById('groupName').value.trim();
            const description = document.getElementById('groupDescription').value.trim();
            const startDate   = document.getElementById('groupStartDate').value;
            const endDate     = document.getElementById('groupEndDate').value;
            if (!name || !startDate || !endDate) return;
            if (endDate <= startDate) { alert('End date must be after start date.'); return; }

            try {
                if (_gcEditingGroupId) {
                    await updateDoc(doc(db, GC_COL, _gcEditingGroupId), { name, description, startDate, endDate });
                    showToast('Group challenge updated.', 'blue');
                } else {
                    if (gcGetActiveGroupId()) { alert('You are already in an active group challenge. Exit it first.'); return; }
                    const inviteCode = gcGenerateCode();
                    const user = window.currentUser;
                    const me = {
                        uid:         myUID,
                        displayName: (window.userData.profile?.username) || user.displayName || 'Unknown',
                        photoURL:    user.photoURL || null,
                        level:       window.userData.level || 1,
                        status:      'active',
                        joinedAt:    new Date().toISOString(),
                        nominations: [],
                        lastActiveDate: null,
                        // legacy fields kept for compat
                        nominatedChallengeId: null, nominatedChallengeName: null,
                        challengeTarget: 0, challengeCurrent: 0, challengeStatus: null,
                    };
                    const groupDoc = {
                        name, description, startDate, endDate,
                        creatorUid: myUID, status: 'active', inviteCode,
                        createdAt: new Date().toISOString(),
                        members: { [myUID]: me },
                    };
                    const ref = await addDoc(collection(db, GC_COL), groupDoc);
                    await setDoc(doc(db, GC_CODES, inviteCode), { groupId: ref.id, createdAt: new Date().toISOString() });
                    window.userData.activeGroupChallengeId = ref.id;
                    await saveUserData();
                    showToast('🏆 Group challenge created!', 'blue');
                }
                closeGroupCreateModal();
                renderGroupChallengeTab();
            } catch(e) {
                console.error('GC save error:', e);
                showToast('Failed to save group challenge.', 'red');
            }
        };

        // ── Delete Group (creator only) ───────────────────────────────────

        window.gcDeleteGroupConfirm = function(groupId) {
            if (!confirm('Delete this group challenge permanently? All members will be removed. This cannot be undone.')) return;
            gcDeleteGroup(groupId);
        };

        window.gcDeleteGroup = async function(groupId) {
            const myUID = window.currentUser?.uid;
            try {
                // Clear activeGroupChallengeId for all members (best effort)
                const snap = await getDoc(doc(db, GC_COL, groupId));
                if (snap.exists()) {
                    const members = snap.data().members || {};
                    // We can't batch-write other users' docs from the client, so we just delete the group doc.
                    // Each user's stale activeGroupChallengeId will be cleaned up when they next load.
                }
                await deleteDoc(doc(db, GC_COL, groupId));
                window.userData.activeGroupChallengeId = null;
                await saveUserData();
                showToast('Group challenge deleted.', 'olive');
                renderGroupChallengeTab();
            } catch(e) {
                console.error('GC delete error:', e);
                showToast('Failed to delete group.', 'red');
            }
        };

        // ── Join by Code ──────────────────────────────────────────────────

        window.openGroupJoinModal = function() {
            document.getElementById('groupJoinCodeInput').value = '';
            document.getElementById('groupJoinModal').classList.add('active');
        };

        window.closeGroupJoinModal = function() {
            document.getElementById('groupJoinModal').classList.remove('active');
        };

        window.joinGroupByCode = async function() {
            const code = (document.getElementById('groupJoinCodeInput').value || '').trim().toUpperCase();
            if (code.length < 6) { alert('Please enter a valid 6-character invite code.'); return; }
            if (gcGetActiveGroupId()) { alert('You are already in a group challenge. Exit it first.'); return; }
            try {
                const codeSnap = await getDoc(doc(db, GC_CODES, code));
                if (!codeSnap.exists()) { alert('Invite code not found. Double-check and try again.'); return; }
                await gcJoinGroup(codeSnap.data().groupId);
                closeGroupJoinModal();
            } catch(e) {
                console.error('GC join error:', e);
                showToast('Failed to join group.', 'red');
            }
        };

        async function gcJoinGroup(groupId) {
            const myUID = window.currentUser?.uid;
            const user  = window.currentUser;
            const groupSnap = await getDoc(doc(db, GC_COL, groupId));
            if (!groupSnap.exists()) { showToast('Group not found.', 'red'); return; }
            const group = groupSnap.data();
            if (group.members?.[myUID]?.status === 'active') { showToast('You are already in this group.', 'blue'); return; }
            const activeMembers = Object.values(group.members || {}).filter(m => m.status === 'active');
            if (activeMembers.length >= 10) { alert('This group is full (max 10 members).'); return; }

            const me = {
                uid:         myUID,
                displayName: (window.userData.profile?.username) || user.displayName || 'Unknown',
                photoURL:    user.photoURL || null,
                level:       window.userData.level || 1,
                status:      'active',
                joinedAt:    new Date().toISOString(),
                nominations: [],
                lastActiveDate: null,
                nominatedChallengeId: null, nominatedChallengeName: null,
                challengeTarget: 0, challengeCurrent: 0, challengeStatus: null,
            };
            try {
                await updateDoc(doc(db, GC_COL, groupId), { [`members.${myUID}`]: me });
            } catch(e) {
                console.error('gcJoinGroup updateDoc failed:', e.code, e.message);
                throw e;
            }
            window.userData.activeGroupChallengeId = groupId;
            await saveUserData();
            showToast('🏆 Joined group challenge!', 'blue');
            renderGroupChallengeTab();
        }

        // ── Accept / Decline Invite ───────────────────────────────────────

        window.gcAcceptInvite = async function(groupId, inviteDocId) {
            if (gcGetActiveGroupId()) { alert('You are already in a group challenge. Exit it first to join this one.'); return; }
            try {
                await gcJoinGroup(groupId);
                if (inviteDocId) {
                    await updateDoc(doc(db, GC_INVITES, inviteDocId), { status: 'accepted' }).catch(e => console.warn('Could not mark invite accepted:', e.message));
                }
            } catch(e) {
                console.error('gcAcceptInvite failed:', e.code, e.message);
                showToast('Failed to accept invite.', 'red');
            }
        };

        window.gcDeclineInvite = async function(inviteDocId, groupId) {
            try {
                if (inviteDocId) await updateDoc(doc(db, GC_INVITES, inviteDocId), { status: 'declined' });
                showToast('Invite declined.', 'olive');
                renderGroupChallengeTab();
            } catch(e) { showToast('Failed to decline invite.', 'red'); }
        };

        // ── Nominate / Manage Challenges ──────────────────────────────────

        window.openGroupNominateModal = async function() {
            const myUID   = window.currentUser?.uid;
            const groupId = gcGetActiveGroupId();
            if (!groupId) return;

            // Get current nominations from the group doc
            let currentNoms = [];
            try {
                const snap = await getDoc(doc(db, GC_COL, groupId));
                if (snap.exists()) currentNoms = gcNormaliseNominations(snap.data().members?.[myUID] || {});
            } catch(e) {}

            const activeChallenges = (window.userData.challenges || []).filter(c => c.status === 'active');
            const nominatedIds     = currentNoms.map(n => n.challengeId);
            const remaining        = GC_MAX_NOMS - currentNoms.length;

            const list = document.getElementById('groupNominateList');

            // Current nominations section
            const currentSection = currentNoms.length > 0 ? `
                <div class="gc-nom-section-title">Currently Nominated (${currentNoms.length}/${GC_MAX_NOMS})</div>
                ${currentNoms.map(n => `
                    <div class="gc-nominate-current">
                        <div class="gc-nominate-current-name">${escapeHtml(n.challengeName)}</div>
                        <button class="gc-nom-remove-btn" onclick="gcRemoveNomination('${n.challengeId}')">Remove</button>
                    </div>`).join('')}
                ${remaining > 0 ? `<div class="gc-nom-section-title" style="margin-top:14px;">Add Another (${remaining} slot${remaining > 1 ? 's' : ''} left)</div>` : ''}
            ` : '';

            // Available challenges to nominate
            const available = activeChallenges.filter(c => !nominatedIds.includes(c.id));
            const availableSection = remaining > 0 && available.length > 0 ? available.map(ch => {
                const pct = ch.targetCount > 0 ? Math.min(100, Math.round((ch.currentCount / ch.targetCount) * 100)) : 0;
                const metricLabel = ch.metricEnabled && ch.metricQty ? ` · 🎯 ${ch.metricQty} ${ch.metricUnit}` : '';
                return `
                    <div class="gc-nominate-item" onclick="gcNominateChallenge('${ch.id}')">
                        <div>
                            <div class="gc-nominate-item-name">${escapeHtml(ch.name)}</div>
                            <div class="gc-nominate-item-progress">${pct}% done${metricLabel}</div>
                        </div>
                        <button class="gc-nominate-select-btn">＋ Add</button>
                    </div>`;
            }).join('') : remaining === 0 ? '<p style="color:var(--color-text-secondary);font-size:12px;margin-top:8px;">Max 3 challenges nominated. Remove one to add another.</p>'
              : '<p style="color:var(--color-text-secondary);font-size:13px;">No other active challenges to add. Create one first.</p>';

            list.innerHTML = currentSection + availableSection;
            document.getElementById('groupNominateModal').classList.add('active');
        };

        window.closeGroupNominateModal = function() {
            document.getElementById('groupNominateModal').classList.remove('active');
        };

        window.gcNominateChallenge = async function(challengeId) {
            const myUID   = window.currentUser?.uid;
            const groupId = gcGetActiveGroupId();
            if (!myUID || !groupId) return;

            const challenge = (window.userData.challenges || []).find(c => c.id === challengeId);
            if (!challenge) return;

            try {
                const snap = await getDoc(doc(db, GC_COL, groupId));
                if (!snap.exists()) return;
                const member = snap.data().members?.[myUID] || {};
                const currentNoms = gcNormaliseNominations(member);
                if (currentNoms.length >= GC_MAX_NOMS) { showToast('Max 3 challenges reached.', 'red'); return; }
                if (currentNoms.some(n => n.challengeId === challengeId)) { showToast('Already nominated.', 'blue'); return; }

                const nom = {
                    challengeId,
                    challengeName:    challenge.name,
                    challengeTarget:  challenge.targetCount || 0,
                    challengeCurrent: challenge.currentCount || 0,
                    challengeStatus:  challenge.status,
                    metricEnabled:    !!(challenge.metricEnabled && challenge.metricQty),
                    metricQty:        challenge.metricQty || null,
                    metricUnit:       challenge.metricUnit || null,
                    metricCurrent:    challenge.metricCurrent || 0,
                };

                const updatedNoms = [...currentNoms, nom];
                await updateDoc(doc(db, GC_COL, groupId), {
                    [`members.${myUID}.nominations`]:     updatedNoms,
                    [`members.${myUID}.lastActiveDate`]:  null,
                    // Keep legacy fields pointing to first nomination for compat
                    [`members.${myUID}.nominatedChallengeId`]:   updatedNoms[0].challengeId,
                    [`members.${myUID}.nominatedChallengeName`]: updatedNoms[0].challengeName,
                });
                showToast(`🎯 "${challenge.name}" added to group!`, 'blue');
                closeGroupNominateModal();
                renderGroupChallengeTab();
            } catch(e) {
                console.error('GC nominate error:', e);
                showToast('Failed to nominate challenge.', 'red');
            }
        };

        window.gcRemoveNomination = async function(challengeId) {
            const myUID   = window.currentUser?.uid;
            const groupId = gcGetActiveGroupId();
            if (!myUID || !groupId) return;
            try {
                const snap = await getDoc(doc(db, GC_COL, groupId));
                if (!snap.exists()) return;
                const member  = snap.data().members?.[myUID] || {};
                const updated = gcNormaliseNominations(member).filter(n => n.challengeId !== challengeId);
                await updateDoc(doc(db, GC_COL, groupId), {
                    [`members.${myUID}.nominations`]:          updated,
                    [`members.${myUID}.nominatedChallengeId`]: updated[0]?.challengeId || null,
                    [`members.${myUID}.nominatedChallengeName`]: updated[0]?.challengeName || null,
                });
                showToast('Challenge removed from group.', 'olive');
                openGroupNominateModal(); // Refresh modal
            } catch(e) { showToast('Failed to remove nomination.', 'red'); }
        };

        // ── Progress Sync ─────────────────────────────────────────────────

        window.gcSyncProgress = async function() {
            const myUID   = window.currentUser?.uid;
            const groupId = gcGetActiveGroupId();
            if (!myUID || !groupId) return;

            try {
                const groupSnap = await getDoc(doc(db, GC_COL, groupId));
                if (!groupSnap.exists()) return;
                const member = groupSnap.data().members?.[myUID];
                if (!member) return;

                const noms = gcNormaliseNominations(member);
                if (noms.length === 0) return;

                const today = localToday();
                // Update each nomination from local challenge data
                const updatedNoms = noms.map(n => {
                    const ch = (window.userData.challenges || []).find(c => c.id === n.challengeId);
                    if (!ch) return n;
                    return {
                        ...n,
                        challengeTarget:  ch.targetCount  || 0,
                        challengeCurrent: ch.currentCount || 0,
                        challengeStatus:  ch.status,
                        metricEnabled:    !!(ch.metricEnabled && ch.metricQty),
                        metricQty:        ch.metricQty     || null,
                        metricUnit:       ch.metricUnit    || null,
                        metricCurrent:    ch.metricCurrent || 0,
                    };
                });

                // Only mark active today if a nominated challenge actually progressed
                const progressMade = updatedNoms.some((n, i) =>
                    (n.challengeCurrent > (noms[i]?.challengeCurrent || 0)) ||
                    (n.metricCurrent    > (noms[i]?.metricCurrent    || 0))
                );

                await updateDoc(doc(db, GC_COL, groupId), {
                    [`members.${myUID}.nominations`]: updatedNoms,
                    [`members.${myUID}.level`]:       window.userData.level || 1,
                    // Only stamp lastActiveDate when challenge-linked work happened
                    ...(progressMade ? { [`members.${myUID}.lastActiveDate`]: today } : {}),
                    // Legacy compat
                    [`members.${myUID}.challengeTarget`]:  updatedNoms[0]?.challengeTarget  || 0,
                    [`members.${myUID}.challengeCurrent`]: updatedNoms[0]?.challengeCurrent || 0,
                    [`members.${myUID}.challengeStatus`]:  updatedNoms[0]?.challengeStatus  || null,
                });
            } catch(e) { console.warn('GC sync failed (non-critical):', e); }
        };

        // Hook saveChallenge to re-sync group progress
        const _gcOrigSaveChallenge = window.saveChallenge;
        window.saveChallenge = async function(event) {
            await _gcOrigSaveChallenge(event);
            gcSyncProgress().catch(() => {});
        };

        // ── Exit Group (with auto-promote leader) ─────────────────────────

        window.gcConfirmExit = function(groupId) {
            if (!confirm('Exit this group challenge? Your progress stays visible to the group but you will be removed.')) return;
            gcExitGroup(groupId);
        };

        window.gcExitGroup = async function(groupId) {
            const myUID = window.currentUser?.uid;
            if (!myUID) return;
            try {
                const snap = await getDoc(doc(db, GC_COL, groupId));
                if (!snap.exists()) return;
                const group = snap.data();
                const activeMembers = Object.values(group.members || {}).filter(m => m.status === 'active');

                // If last member — delete the whole group
                if (activeMembers.length <= 1) {
                    await deleteDoc(doc(db, GC_COL, groupId));
                    window.userData.activeGroupChallengeId = null;
                    await saveUserData();
                    showToast('Group deleted — you were the last member.', 'olive');
                    renderGroupChallengeTab();
                    return;
                }

                const updates = { [`members.${myUID}.status`]: 'exited' };

                // Auto-promote earliest other member if exiting leader
                if (group.creatorUid === myUID) {
                    const others = activeMembers.filter(m => m.uid !== myUID)
                        .sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));
                    if (others.length > 0) {
                        updates.creatorUid = others[0].uid;
                        showToast(`👑 ${others[0].displayName || 'Next member'} is the new group leader.`, 'blue');
                    }
                }

                await updateDoc(doc(db, GC_COL, groupId), updates);
                window.userData.activeGroupChallengeId = null;
                await saveUserData();
                showToast('You have exited the group challenge.', 'olive');
                renderGroupChallengeTab();
            } catch(e) {
                console.error('GC exit error:', e);
                showToast('Failed to exit group.', 'red');
            }
        };

        // ── Remove Member (creator only) ──────────────────────────────────

        window.gcRemoveMember = async function(groupId, uid) {
            if (!confirm('Remove this member from the group?')) return;
            try {
                await updateDoc(doc(db, GC_COL, groupId), { [`members.${uid}.status`]: 'exited' });
                showToast('Member removed.', 'olive');
                renderGroupChallengeTab();
            } catch(e) { showToast('Failed to remove member.', 'red'); }
        };

        // ── Invite Members Modal ──────────────────────────────────────────

        window.openGroupInviteModal = async function(groupId) {
            const snap = await getDoc(doc(db, GC_COL, groupId)).catch(() => null);
            if (!snap?.exists()) return;
            const group   = snap.data();
            const myUID   = window.currentUser?.uid;
            const friends = window.userData.friends || [];

            document.getElementById('inviteModalCode').textContent = group.inviteCode || '———';
            window._gcInviteModalGroupId   = groupId;
            window._gcInviteModalGroupName = group.name;
            window._gcInviteModalCode      = group.inviteCode;

            const friendList = document.getElementById('groupInviteFriendsList');
            if (friends.length === 0) {
                friendList.innerHTML = '<p style="color:var(--color-text-secondary);font-size:13px;">No friends yet. Share the invite code instead.</p>';
            } else {
                const rows = await Promise.all(friends.map(async uid => {
                    const alreadyMember = group.members?.[uid]?.status === 'active';
                    try {
                        const pSnap = await getDoc(doc(db, 'publicProfiles', uid));
                        const name  = pSnap.exists() ? (pSnap.data().displayName || uid) : uid;
                        return { uid, name, alreadyMember };
                    } catch(e) { return { uid, name: uid, alreadyMember }; }
                }));
                friendList.innerHTML = rows.map(r => `
                    <div class="gc-friend-invite-row">
                        <span class="gc-friend-invite-name">${escapeHtml(r.name)}</span>
                        ${r.alreadyMember
                            ? `<button class="gc-friend-invite-btn sent">In Group</button>`
                            : `<button class="gc-friend-invite-btn" onclick="gcSendInvite('${r.uid}','${r.name}')">Invite</button>`}
                    </div>`).join('');
            }
            document.getElementById('groupInviteModal').classList.add('active');
        };

        window.closeGroupInviteModal = function() {
            document.getElementById('groupInviteModal').classList.remove('active');
        };

        window.gcSendInvite = async function(inviteeUid, inviteeName) {
            const myUID     = window.currentUser?.uid;
            const groupId   = window._gcInviteModalGroupId;
            const groupName = window._gcInviteModalGroupName;
            if (!myUID || !groupId) return;
            const senderName = (window.userData.profile?.username) || window.currentUser.displayName || 'Someone';
            // Deterministic doc ID: one invite per (group, inviter, invitee) — prevents duplicates
            const inviteDocId = `${groupId}_${myUID}_${inviteeUid}`;
            try {
                await setDoc(doc(db, GC_INVITES, inviteDocId), {
                    groupId, groupName,
                    inviterUid: myUID, inviterName: senderName,
                    inviteeUid, status: 'pending',
                    createdAt: new Date().toISOString(),
                }, { merge: true }); // merge:true so re-invite resets status to pending if previously declined
                showToast(`Invite sent to ${inviteeName}!`, 'blue');
                openGroupInviteModal(groupId);
            } catch(e) { showToast('Failed to send invite.', 'red'); }
        };

        window.copyGroupCodeFromModal = function() { gcCopyCode(window._gcInviteModalCode || ''); };
        window.shareGroupLinkFromModal = function() { gcShareLink(window._gcInviteModalCode || ''); };

        window.gcCopyCode = function(code) {
            if (!code) return;
            navigator.clipboard.writeText(code)
                .then(() => showToast(`Code ${code} copied!`, 'blue'))
                .catch(() => showToast(code, 'blue'));
        };

        window.gcShareLink = function(code) {
            const url = `${window.location.origin}${window.location.pathname}?joinGroup=${code}`;
            navigator.clipboard.writeText(url)
                .then(() => showToast('Invite link copied!', 'blue'))
                .catch(() => showToast(url, 'blue'));
        };

        // ── SubTab hook ───────────────────────────────────────────────────

        (function() {
            const _orig = window.switchSubTab;
            window.switchSubTab = function(parentTab, subTab) {
                _orig(parentTab, subTab);
                if (parentTab === 'challenges' && subTab === 'groupChallenge') renderGroupChallengeTab();
            };
        })();

        // ── Hook activity completion → sync group progress ────────────────

        (function() {
            const _origComplete = window.completeActivity;
            if (typeof _origComplete === 'function') {
                window.completeActivity = async function(...args) {
                    await _origComplete(...args);
                    gcSyncProgress().catch(() => {});
                };
            }
        })();

        // ── Deep link ─────────────────────────────────────────────────────

        function handleGroupDeepLink() {
            try {
                const params = new URLSearchParams(window.location.search);
                if (params.get('joinGroup')) {
                    switchTab('challenges');
                    setTimeout(() => switchSubTab('challenges', 'groupChallenge'), 300);
                }
            } catch(e) {}
        }
