        import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
        import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
        import { getFirestore, doc, getDoc, getDocFromCache, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, getDocs, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
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

            // ── Share button — canonical primary CTA pill ─────────────
            // Same recipe as .level-up-share-btn / spotlight-cta:
            // solid var(--color-progress) bg with inset highlight + glow
            // halo. Inline styled because this overlay is built ad-hoc
            // and not part of the regular CSS surface.
            const shareBtn = document.createElement('button');
            shareBtn.style.cssText = [
                'padding:12px 22px',
                'background:var(--color-progress)',
                'color:#fff', 'border:none', 'border-radius:100px',
                'font-size:14px', 'font-weight:700', 'cursor:pointer',
                'font-family:inherit', 'display:inline-flex', 'align-items:center',
                'gap:8px', 'letter-spacing:-0.005em',
                'box-shadow:0 1px 0 rgba(255,255,255,0.16) inset, 0 6px 22px rgba(90,159,212,0.40)',
                '-webkit-tap-highlight-color:transparent'
            ].join(';') + ';';
            shareBtn.innerHTML =
                '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
                '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/>' +
                '<circle cx="18" cy="19" r="3"/>' +
                '<line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>' +
                '<line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>' +
                '<span>Share</span>';
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

            // ── Save / Download button — ghost variant ────────────────
            const saveBtn = document.createElement('button');
            saveBtn.style.cssText = [
                'padding:12px 22px',
                'background:rgba(255,255,255,0.05)',
                'color:#fff', 'border:1px solid rgba(255,255,255,0.10)',
                'border-radius:100px', 'font-size:14px', 'font-weight:600',
                'cursor:pointer', 'font-family:inherit',
                'display:inline-flex', 'align-items:center', 'gap:8px',
                'letter-spacing:-0.005em',
                '-webkit-tap-highlight-color:transparent'
            ].join(';') + ';';
            saveBtn.innerHTML =
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
                '<polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
                '<span>Save image</span>';
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

            // ── Close button — minimal ghost ──────────────────────────
            const closeBtn = document.createElement('button');
            closeBtn.style.cssText = [
                'padding:12px 22px',
                'background:transparent', 'color:rgba(255,255,255,0.55)',
                'border:none', 'border-radius:100px',
                'font-size:14px', 'font-weight:500', 'cursor:pointer',
                'font-family:inherit', 'letter-spacing:-0.005em',
                '-webkit-tap-highlight-color:transparent'
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
            if (btn) {
                btn.disabled = true;
                // Only swap the inner <span> text — keep the SVG glyph mounted.
                const lbl = btn.querySelector('span');
                if (lbl) lbl.textContent = 'Building card…';
                else btn.textContent = 'Building card…';
            }
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
                if (btn) {
                    btn.disabled = false;
                    // Preserve the SVG glyph — assignment to textContent would
                    // wipe the icon. We rebuild the same innerHTML used at
                    // creation time so the button looks identical to before.
                    btn.innerHTML =
                        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                        'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
                        '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/>' +
                        '<circle cx="18" cy="19" r="3"/>' +
                        '<line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>' +
                        '<line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>' +
                        '<span>Share progress</span>';
                }
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
                    migrateQuestsV2();
                    processQuestRepeat();
                    scheduleReminder();
                    updateDashboard();
                    updateProfileAvatar();
                    // Apply persisted Activities sub-tab on cold start.
                    // updateDashboard() doesn't go through switchTab('activities'),
                    // so the restore block inside that function never fires on app
                    // load. Without this, the saved preference (categories) is
                    // silently ignored and the tab always opens on My Activities.
                    (function applyPersistedActivitiesSubTab() {
                        var sub = window.userData
                                  && window.userData.settings
                                  && window.userData.settings.activitiesLastSubTab;
                        if ((sub === 'categories' || sub === 'quests') && typeof switchSubTab === 'function') {
                            switchSubTab('activities', sub);
                        }
                    })();
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
                            // Race invites fire after the unlock popups have
                            // had their window (internal guard prevents overlap)
                            setTimeout(() => checkPendingChallengeInvites(), 2000);
                            // Pull/push race progress once per login
                            setTimeout(() => syncChallengeRaceProgress().catch(() => {}), 3000);
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
                            dimensions: [], activities: [], challenges: [], quests: []
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
                // Backfill quests array for existing users (added later)
                if (!Array.isArray(window.userData.quests)) window.userData.quests = [];
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
                    dimensions: [], activities: [], challenges: [], quests: [],
                    rewards: {}, friends: [],
                    friendCode: generateFriendCode(),
                    createdAt: new Date().toISOString()
                };
            }
            console.log('User data ready');

            // Apply theme mode (light/dark) as early as possible — BEFORE the app
            // container becomes visible — so light-theme users don't see a flash
            // of dark surfaces while loadSettings() catches up.
            try {
                var _theme = (window.userData && window.userData.settings && window.userData.settings.theme) || {};
                var _mode = _theme.mode;
                if (!_mode && _theme.presetId && typeof THEMES !== 'undefined') {
                    var _t = THEMES.find(function(x){ return x.id === _theme.presetId; });
                    _mode = (_t && _t.mode) ? _t.mode : 'dark';
                }
                document.documentElement.setAttribute('data-theme-mode', _mode === 'light' ? 'light' : 'dark');
            } catch (e) { /* non-fatal, loadTheme will set it later */ }
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
            // Mirror the level into the gold-trace overlay AND dynamically
            // resize the SVG container to fit the actual rendered text.
            // The trace animation is gated by .trace-ready — we only add
            // it AFTER the width has been measured and committed, so the
            // gold stroke never animates while the SVG is being resized
            // (which previously caused a visible jitter on first load).
            (function syncLevelSvgWidth() {
                var traceEl = document.getElementById('currentLevelTrace');
                if (traceEl) traceEl.textContent = level;
                var fillEl = document.getElementById('currentLevel');
                var svgEl = document.getElementById('levelSvg');
                if (!fillEl || !svgEl) return;
                requestAnimationFrame(function() {
                    try {
                        var len = fillEl.getComputedTextLength();
                        if (len > 0) {
                            svgEl.setAttribute('width', Math.ceil(len) + 4);
                        }
                    } catch (e) { /* pre-layout — retried on next dashboard tick */ }
                    // After width is set, arm the trace animation. The 80ms
                    // delay lets the SVG resize commit visually before the
                    // animation starts, so the user sees a stable digit
                    // outline that begins to trace cleanly.
                    if (traceEl && !traceEl.classList.contains('trace-ready')) {
                        setTimeout(function() {
                            traceEl.classList.add('trace-ready');
                        }, 80);
                    }
                });
            })();
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

            // Kick off the header's alternating XP/% slot if not already
            // running. Lazy-init via updateDashboard so we don't need a
            // separate DOMContentLoaded hook; the dashboard runs once on
            // app boot and is the natural owner of header state.
            if (!window._progressAltStarted && document.querySelector('.progress-alt')) {
                window._progressAltStarted = true;
                _startProgressAltCycle();
            }
        }

        // ── Header progress slot: alternating XP this level ↔ % to next ─
        // Every 30 seconds the active item slides up and out of frame and
        // the next item slides up from below to take its place. The slot
        // height is fixed in CSS (.progress-alt) so the layout never jumps.
        function _startProgressAltCycle() {
            var items = document.querySelectorAll('.progress-alt .progress-alt-item');
            if (items.length < 2) return;
            var activeIdx = 0;
            setInterval(function() {
                var nextIdx = (activeIdx + 1) % items.length;
                items[activeIdx].setAttribute('data-state', 'leaving');
                items[nextIdx].setAttribute('data-state', 'active');
                // After the leaving item has cleared the frame, reset its
                // state so it's ready to slide in from below next cycle.
                // 600ms covers the 550ms CSS transition with a safe margin.
                (function(prev) {
                    setTimeout(function() {
                        if (prev.getAttribute('data-state') === 'leaving') {
                            prev.removeAttribute('data-state');
                        }
                    }, 620);
                })(items[activeIdx]);
                activeIdx = nextIdx;
            }, 30000);
        }

        // ── Activity Sort & Filter ────────────────────────────────────────
        // Icons are stroked SVG glyphs via sortIcon() — no emoji as UI
        // primitives (design brief §4).
        const SORT_OPTIONS = [
            { id: 'by-routine',  icon: 'target', label: 'By Routine' },
            { id: 'smart',       icon: 'bolt',   label: "Today's Focus" },
            { id: 'grouped',     icon: 'list',   label: 'Grouped by frequency' },
            { id: 'streak-high', icon: 'flame',  label: 'Longest streak first' },
        ];
        function sortIcon(name) {
            var paths = {
                target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
                bolt:   '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
                list:   '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
                flame:  '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
            };
            return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || '') + '</svg>';
        }

        // Smart default — picks based on activity count.
        // <10 activities: "Today's Focus" highlights what to do right now
        //                 since the list is short enough to scan.
        // ≥10 activities: "Grouped by frequency" gives structure; without
        //                 grouping a long flat list becomes overwhelming.
        function _countAllActivities() {
            var n = 0;
            (window.userData && window.userData.dimensions || []).forEach(function(dim) {
                (dim.paths || []).forEach(function(path) {
                    n += (path.activities || []).length;
                });
            });
            return n;
        }
        function _smartDefaultSort() {
            return _countAllActivities() < 10 ? 'smart' : 'grouped';
        }

        let _currentSort = null; // set on render

        function getCurrentSort() {
            // Saved user preference wins; otherwise pick the count-based default.
            return _currentSort
                || (window.userData.settings && window.userData.settings.activitySort)
                || _smartDefaultSort();
        }
        function getDefaultActivitySort() { return _smartDefaultSort(); }

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
                    <span class="fo-icon">${sortIcon(o.icon)}</span>
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
            if (dot) dot.style.display = (sortId !== getDefaultActivitySort()) ? 'block' : 'none';
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

            // Initialise sort from stored preference on first render.
            // Runs BEFORE the empty-state check because Quests mode must
            // render even when the user has zero activities.
            if (!_currentSort) {
                _currentSort = (window.userData.settings && window.userData.settings.activitySort) || getDefaultActivitySort();
                // If user had a removed sort saved (xp-high/xp-low), fall back to smart default
                if (!SORT_OPTIONS.find(o => o.id === _currentSort)) _currentSort = getDefaultActivitySort();
                const dot = document.getElementById('filterActiveDot');
                if (dot) dot.style.display = (_currentSort !== getDefaultActivitySort()) ? 'block' : 'none';
            }

            const sort = getCurrentSort();

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

            // Update activity count in header
            const _slotEl = document.getElementById('activitySlotCount');
            if (_slotEl) {
                const { total: _actT, limit: _actL } = getActivityCounts();
                _slotEl.textContent = _actT + '/' + _actL;
            }

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

                // Quest tasks whose date window covers today: linked
                // activities float to the top of To Do; unlinked tasks
                // render as a pinned strip above the buckets.
                var _questWinItems = getActiveQuestWindowItems();
                var _questWinActIds = new Set();
                var _questWinTasks = [];
                _questWinItems.forEach(function(it) {
                    if (it.task.activityId) _questWinActIds.add(it.task.activityId);
                    else _questWinTasks.push(it);
                });

                allActivities.forEach(function(a) {
                    var completed = a._completedToday;
                    var canDo = a._canComplete;
                    var isMulti = a.allowMultiplePerDay && a.frequency !== 'occasional';
                    var notScheduled = a.frequency === 'custom' && a.customSubtype === 'days' && !a._isScheduledDay;
                    var doneAnythingToday = a._countToday > 0;

                    a._questWindowActive = _questWinActIds.has(a.id);

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

                // Within To Do: quest-window items first, then pinned, then
                // frequency rank, then XP desc
                toDo.sort(function(a, b) {
                    var qwA = a._questWindowActive ? 0 : 1;
                    var qwB = b._questWindowActive ? 0 : 1;
                    if (qwA !== qwB) return qwA - qwB;
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
                    { key: 'smart_todo',   label: 'To Do',    activities: toDo },
                    { key: 'smart_done',   label: 'Done',     activities: doneTd },
                    { key: 'smart_notnow', label: 'Not Now',  activities: notNow },
                ].filter(function(g) { return g.activities.length > 0; });

                // Pinned quest-window strip — unlinked quest tasks due now (cap 3)
                var questStripHtml = '';
                if (_questWinTasks.length) {
                    questStripHtml = '<div class="quest-win-strip">'
                        + _questWinTasks.slice(0, 3).map(function(it) {
                            return '<div class="quest-win-row" onclick="openQuestFromToday(\'' + it.quest.id + '\')">'
                                + '<span class="quest-win-kicker">' + escapeHtml(it.quest.name) + '</span>'
                                + '<span class="quest-win-title">' + escapeHtml(it.task.title || '') + '</span>'
                                + '</div>';
                        }).join('')
                        + '</div>';
                }

                container.innerHTML = questStripHtml + smartGroups.map(function(g) {
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
            } else if (sort === 'by-routine') {
                // ── By Routine — user-defined groups with time windows ─────

                // Empty state — no groups yet. Render the CTA in BOTH views
                // (hoisted above the grid-defer below so grid users also
                // get the "create first group" prompt instead of falling
                // through to "Other" with everything in it).
                if (getGroups().length === 0) {
                    container.innerHTML =
                        '<div class="routine-empty">'
                        + '<div class="routine-empty-emoji">🎯</div>'
                        + '<div class="routine-empty-title">Group activities into routines</div>'
                        + '<div class="routine-empty-sub">Bundle activities like meditation, stretch &amp; workout into a "Morning Routine" so the right things bubble to the top at the right time of day.</div>'
                        + '<button class="btn-primary routine-empty-cta" onclick="openGroupModal()">Create your first group</button>'
                        + '</div>';
                    return;
                }

                // GRID VIEW: defer everything to renderActivityGridCards.
                // The grid renderer already handles the full by-routine
                // layout (group headers, bodies, "Other" section). Running
                // this list-view branch in grid mode caused outer group
                // headers from here AND inner group headers from the grid
                // renderer to BOTH render — N groups looked like N×N.
                // They also shared data-group keys so toggle clicks moved
                // both copies and looked dead. One owner per view-mode
                // fixes both symptoms cleanly.
                if (window._activityViewMode === 'grid') {
                    container.innerHTML = renderActivityGridCards(allActivities);
                    return;
                }

                var userGroups = getGroups();

                // Bucket activities. Multi-group activities appear in EVERY
                // group they belong to. "Ungrouped" is strictly the set of
                // activities not in any group — checked via a Set so we
                // can't accidentally leak a grouped activity into "Other".
                var groupedActIds = new Set();
                var byGid = {};
                userGroups.forEach(function(g) {
                    byGid[g.id] = [];
                    (g.activityIds || []).forEach(function(aid) { groupedActIds.add(aid); });
                });
                allActivities.forEach(function(a) {
                    var matched = false;
                    userGroups.forEach(function(g) {
                        if ((g.activityIds || []).indexOf(a.id) !== -1) {
                            byGid[g.id].push(a);
                            matched = true;
                        }
                    });
                    return matched;
                });
                var ungrouped = allActivities.filter(function(a) { return !groupedActIds.has(a.id); });

                // Order: closest-to-now timed group first ("active"), then
                // other timed groups by start time, then all-day groups.
                var nowDate = new Date();
                var activeGid = getActiveGroupId(nowDate);
                function _bucketRank(g) {
                    if (g.id === activeGid) return 0;
                    if (_groupTimeToMin(g.timeStart) < 0) return 2; // all-day
                    return 1;                                       // other timed
                }
                function _bucketSort(a, b) {
                    var ra = _bucketRank(a), rb = _bucketRank(b);
                    if (ra !== rb) return ra - rb;
                    var sa = _groupTimeToMin(a.timeStart), sb = _groupTimeToMin(b.timeStart);
                    if (sa >= 0 && sb >= 0) return sa - sb;
                    return (a.name || '').localeCompare(b.name || '');
                }
                var orderedGroups = userGroups.slice().sort(_bucketSort);

                var html = '';
                orderedGroups.forEach(function(g) {
                    var acts = byGid[g.id] || [];
                    var isActive = g.id === activeGid;
                    var key = 'routine_' + g.id;
                    // Auto-expand the active group; honor explicit user state otherwise.
                    var stored = window.activityGroupExpanded[key];
                    var isExpanded = (stored === undefined) ? isActive : (stored !== false);
                    var timeBadge = '';
                    if (g.timeStart && g.timeEnd) {
                        timeBadge = '<span class="routine-time-badge'
                            + (isActive ? ' active' : '') + '">'
                            + '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>'
                            + '<span>' + escapeHtml(formatTime12(g.timeStart)) + ' – '
                            + escapeHtml(formatTime12(g.timeEnd)) + '</span></span>';
                    } else {
                        timeBadge = '<span class="routine-time-badge all-day">'
                            + '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/></svg>'
                            + '<span>All day</span></span>';
                    }
                    html += '<div class="act-group routine-group" data-group="' + key + '">'
                        + '<div class="act-group-header routine-group-header" onclick="toggleActivityGroup(\'' + key + '\')">'
                        + '<span class="collapse-icon ' + (isExpanded ? 'expanded' : '') + '" aria-hidden="true">'
                        + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>'
                        + '</span>'
                        + '<span class="act-group-label">' + escapeHtml(g.name) + '</span>'
                        + timeBadge
                        + '<span class="act-group-count">' + acts.length + '</span>'
                        + '<button class="routine-edit-btn" onclick="event.stopPropagation();openGroupModal(\'' + g.id + '\')" title="Edit group" aria-label="Edit group">'
                        + '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
                        + '</button>'
                        + '</div>'
                        + '<div class="act-group-body ' + (isExpanded ? 'expanded' : '') + '">'
                        + (acts.length
                            ? renderActivityContent(acts)
                            : '<div class="routine-empty-inline">No activities in this group yet. <a href="#" onclick="event.preventDefault();openGroupModal(\'' + g.id + '\')">Add some →</a></div>')
                        + '</div></div>';
                });

                // Ungrouped bucket (only shown if non-empty)
                if (ungrouped.length) {
                    var ukey = 'routine_other';
                    var uStored = window.activityGroupExpanded[ukey];
                    // Collapsed by default to keep the active routine visually dominant.
                    var uExpanded = (uStored === true);
                    html += '<div class="act-group" data-group="' + ukey + '">'
                        + '<div class="act-group-header" onclick="toggleActivityGroup(\'' + ukey + '\')">'
                        + '<span class="collapse-icon ' + (uExpanded ? 'expanded' : '') + '" aria-hidden="true">'
                        + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>'
                        + '</span>'
                        + '<span class="act-group-label">Other</span>'
                        + '<span class="act-group-count">' + ungrouped.length + '</span>'
                        + '</div>'
                        + '<div class="act-group-body ' + (uExpanded ? 'expanded' : '') + '">'
                        + renderActivityContent(ungrouped)
                        + '</div></div>';
                }

                // Footer entry to add another group
                html += '<div class="routine-add-row">'
                    + '<button class="routine-add-btn" onclick="openGroupModal()">+ New group</button>'
                    + '</div>';

                container.innerHTML = html;

            } else {
                var sorted = allActivities.slice();
                if (sort === 'streak-high') {
                    sorted.sort((a, b) => (b._streak || 0) - (a._streak || 0));
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

            // One-shot animation marker: cleared after this render so the
            // freshly-toggled card animates exactly once and subsequent
            // re-renders (group toggles, filter changes) don't re-fire it.
            window._justToggledActivityId = null;
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
            raceSyncSoon();
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
            raceSyncSoon();
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
            blue:   'var(--color-accent-blue)',
            red:    'var(--color-accent-red)',
            green:  'var(--color-accent-green)',
            olive:  'var(--color-accent-olive)',
            purple: 'var(--color-accent-purple)',
            teal:   'var(--color-accent-teal)',
            amber:  'var(--color-accent-amber)',
            rose:   'var(--color-accent-rose)',
            indigo: 'var(--color-accent-indigo)',
            sage:   'var(--color-accent-sage)',
        };

        var DIM_HEX_MAP = {
            blue:   '#4a7c9e',
            red:    '#8e3b5f',
            green:  '#6b7c3f',
            olive:  '#7a7b4d',
            purple: '#7a5d9e',
            teal:   '#3f8a87',
            amber:  '#b88242',
            rose:   '#c26a7a',
            indigo: '#5a6ba8',
            sage:   '#6b8b6f',
        };

        // Canonical order — used by the dimension color picker. First four
        // are the legacy palette; new ones append so existing dimensions
        // keep their hex values unchanged.
        var DIM_COLOR_ORDER = ['blue','green','olive','red','teal','sage','purple','indigo','rose','amber'];

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

                // Cycle-complete detection: a custom activity that has
                // hit its timesPerCycle target should render as "fully
                // done" — green ring fill, no orange streak arc. Without
                // this check, the streak arc kept drawing on top of the
                // green fill and the ring looked half-done even though
                // the cycle was complete.
                const cycleComplete = (
                    activity.frequency === 'custom' &&
                    (activity._cycleCompletions || 0) >= (activity.timesPerCycle || 1)
                );

                // Dimension color for ring (falls back to theme accent
                // — --color-progress — if no dimension color is set).
                const dimHex = DIM_HEX_MAP[activity.dimColor] || null;

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
                else if (cycleComplete)     { clickHandler = 'void(0)'; itemClass = 'completed'; }
                else if (allowMulti)        { clickHandler = `completeActivityById('${activity.id}')`; itemClass = completedToday ? 'completed-multi' : (isSkipMode ? 'skip-mode-pending' : ''); }
                else if (completedToday)    { clickHandler = 'void(0)'; itemClass = 'completed'; }
                else if (canComplete)       { clickHandler = `completeActivityById('${activity.id}')`; itemClass = isSkipMode ? 'skip-mode-pending' : ''; }
                else                        { clickHandler = 'void(0)'; itemClass = 'disabled'; }

                // Undo button
                const todayCompletionCount = activity._countToday;
                const showUndo = todayCompletionCount > 0 && !notScheduledToday;
                const undoBtn = showUndo
                    ? `<button class="btn-undo-activity" onclick="event.stopPropagation();undoActivityById('${activity.id}')" title="Undo last completion" aria-label="Undo completion"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>Undo</button>`
                    : '';

                // Multi counter
                let multiCounterHtml = '';
                if (allowMulti && todayCompletionCount > 0) multiCounterHtml = `<span class="card-multi-count">×${todayCompletionCount}</span>`;

                // XP display in row — always suffixed with "XP" so the
                // value reads as a unit (e.g. "+20 XP") instead of a bare
                // number that could be mistaken for a count or multiplier.
                let xpText;
                if (isSkipMode && !completedToday) xpText = `+${displayXP} XP`;
                else xpText = `${activity.isNegative ? '−' : '+'}${displayXP} XP`;
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

                // Streak chip — coral (celebratory)
                const streakChip = currentStreak > 0
                    ? `<span class="card-streak" aria-label="${currentStreak}-day streak"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>${currentStreak}</span>`
                    : '';

                // At-risk chip — amber (warning)
                const atRiskChip = atRisk
                    ? `<span class="card-atrisk" aria-label="Streak at risk"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.7 3h16.96a2 2 0 0 0 1.7-3L13.7 3.86a2 2 0 0 0-3.4 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>Risk</span>`
                    : '';

                return `
                <div class="activity-item ${itemClass}${window._justToggledActivityId === activity.id ? ' just-toggled' : ''}" data-aid="${activity.id}" onclick="${clickHandler}"
                     ${dimHex ? `style="--dim-color:${dimHex};"` : ''}>
                    <div class="activity-info-container">
                        <div class="activity-row-main">
                            <button class="act-expand-btn" onclick="event.stopPropagation();toggleCardExpand('${activity.id}')" title="Show details" aria-label="Expand">
                                <svg class="act-expand-chevron ${isExpanded ? 'expanded' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                                ${hasAlert ? '<span class="chevron-alert-dot"></span>' : ''}
                            </button>
                            <div class="card-content-col">
                                <div class="activity-name">${escapeHtml(activity.name)}</div>
                                <div class="card-meta">
                                    <span class="${xpColorClass}">${xpText}</span>
                                    ${streakChip}
                                    ${multiCounterHtml}
                                    ${atRiskChip}
                                </div>
                            </div>
                            <div class="activity-row-right">
                                <!-- Undo button (LEFT of ring) appears only after completion.
                                     Ring stays fixed at the rightmost edge; undo slides in
                                     to the LEFT of the ring with the same animation. -->
                                ${undoBtn}
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
                                            ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
                                            : ''
                                        }
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="activity-expand-body ${isExpanded ? 'expanded' : ''}">
                            <div class="activity-details">${detailBadges.join('')}</div>
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
            // If the inline planner is open, treat this button as "exit planner"
            // and return to whichever view (list/grid) was active.
            var plannerEl = document.getElementById('activitiesInlinePlanner');
            if (plannerEl && plannerEl.style.display === 'block') {
                togglePlannerInline();
                return;
            }
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
            // Grid icon (4 squares) → shown when we're in LIST mode
            // List icon (clean rounded rows, no dots) → shown when we're in GRID mode
            btn.innerHTML = isGrid
                ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="3" rx="1"/><rect x="3" y="10.5" width="18" height="3" rx="1"/><rect x="3" y="17" width="18" height="3" rx="1"/></svg>'
                : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>';
            btn.title = isGrid ? 'Switch to list view' : 'Switch to grid view';
            // No glow in either state — the icon shape itself conveys mode.
            // (.active was previously added in grid mode, which lit the underline.)
            btn.classList.remove('active');
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

            // Card sizes (cols × rows). Order is hand-picked so the picker
            // renders in a balanced 3-column layout that fits any phone.
            var types = [
                { t:1, label:'Small',     w:1, h:1 },
                { t:3, label:'Wide',      w:2, h:1 },
                { t:5, label:'Tall',      w:1, h:2 },
                { t:6, label:'Square',    w:2, h:2 },
                { t:4, label:'Column',    w:1, h:3 },
                { t:7, label:'Row',       w:3, h:1 },
                { t:2, label:'Showcase',  w:3, h:2 },
            ];

            grid.innerHTML = types.map(function(tp) {
                var sel = tp.t === currentType ? ' selected' : '';
                return '<button class="ctp-card' + sel + '" data-type="' + tp.t + '"'
                    + ' data-w="' + tp.w + '" data-h="' + tp.h + '"'
                    + ' onclick="selectCardType(' + tp.t + ')">'
                    + '<div class="ctp-shape" style="--ctp-w:' + tp.w + ';--ctp-h:' + tp.h + ';">'
                    + '<div class="ctp-shape-inner"></div>'
                    + '</div>'
                    + '<div class="ctp-label">' + tp.label + '</div>'
                    + '<div class="ctp-dims">' + tp.w + '×' + tp.h + '</div>'
                    + '</button>';
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

        // Build ring SVG for grid cards — uniform compact size on all types.
        // Ring is positioned absolutely at bottom-right of the card via CSS.
        // No XP text inside — just checkmark when complete, empty otherwise.
        function _gcRing(completedToday, currentStreak, dimHex, xpText, type) {
            // Single uniform size: 27px (matches the previous compact Type 3 size)
            var size = 27;
            var r    = 11;
            var sw   = 2.2;
            var CIRC = +(2 * Math.PI * r).toFixed(2);
            var prog = Math.min(currentStreak, 5) / 5;
            var offset = (CIRC * (1 - prog)).toFixed(2);
            var cx = size / 2; var cy = size / 2;
            var checkSize = 10;
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
                    : '')
                + '</div></div>';
        }

        function renderActivityGridCards(activities) {
            var challengeActivityIds = new Set();
            (window.userData.challenges || []).forEach(function(ch) {
                if (ch.status !== 'active') return;
                (ch.activityIds || (ch.activityId ? [ch.activityId] : [])).forEach(function(id) { challengeActivityIds.add(id); });
            });

            // Group lookup — only built when the active sort is "by-routine".
            // Any other sort renders a flat grid (groups are not their concern).
            // Reset the legacy shim each render so deleted groups don't linger.
            window._gridGroups = {};
            var groupOrder = [];
            var groupedActIds = new Set();
            var _currentSort = (typeof getCurrentSort === 'function') ? getCurrentSort() : null;
            var _showGroupsInGrid = (_currentSort === 'by-routine');
            var _userGroups = _showGroupsInGrid ? getGroups() : [];
            if (_userGroups.length) {
                // Order: closest-to-now timed group first, then other timed, then all-day.
                var _now = new Date();
                var _activeGid = getActiveGroupId(_now);
                function _gRank(g) {
                    if (g.id === _activeGid) return 0;
                    if (_groupTimeToMin(g.timeStart) < 0) return 2;
                    return 1;
                }
                var _ordered = _userGroups.slice().sort(function(a, b) {
                    var ra = _gRank(a), rb = _gRank(b);
                    if (ra !== rb) return ra - rb;
                    var sa = _groupTimeToMin(a.timeStart), sb = _groupTimeToMin(b.timeStart);
                    if (sa >= 0 && sb >= 0) return sa - sb;
                    return (a.name || '').localeCompare(b.name || '');
                });
                _ordered.forEach(function(g) {
                    groupOrder.push(g.id);
                    window._gridGroups[g.id] = {
                        name: g.name,
                        ids:  (g.activityIds || []).slice(),
                        timeStart: g.timeStart,
                        timeEnd:   g.timeEnd,
                        isActive:  (g.id === _activeGid)
                    };
                    (g.activityIds || []).forEach(function(aid) { groupedActIds.add(aid); });
                });
            }

            // Bucket: multi-group activities appear in every group they're in;
            // "Other" is the set of activities not in ANY group (Set membership
            // check guarantees grouped activities don't leak into Other).
            var byGroup = {};
            groupOrder.forEach(function(gid) { byGroup[gid] = []; });
            activities.forEach(function(a) {
                groupOrder.forEach(function(gid) {
                    if ((window._gridGroups[gid].ids || []).indexOf(a.id) !== -1) {
                        byGroup[gid].push(a);
                    }
                });
            });
            var ungrouped = activities.filter(function(a) { return !groupedActIds.has(a.id); });

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

                // Ring is now positioned absolutely (bottom-left). Type 1 has no ring.
                var ringHtml = (type === 1) ? '' : _gcRing(completedToday, currentStreak, dimHex, xpText, type);

                // Corner undo button: top-right of every card, only when there's
                // something to undo today. Pill-style (with text) on bigger cards
                // (types 2, 6, 4 — wide-enough rooms), icon-only on smaller ones.
                // Visual treatment matches .btn-undo-activity from the list view.
                var undoUsesPill = (type === 2 || type === 6 || type === 4);
                var undoIconSvg = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>';
                var cornerUndoHtml = (todayCount > 0 && !notScheduledToday)
                    ? '<button class="gc-corner-undo' + (undoUsesPill ? ' gc-corner-undo-pill' : '') + '"'
                      + ' onpointerdown="event.stopPropagation()"'
                      + ' onpointerup="event.stopPropagation()"'
                      + ' onclick="event.stopPropagation();undoActivityById(\'' + activity.id + '\')"'
                      + ' title="Undo last completion" aria-label="Undo">'
                      + undoIconSvg
                      + (undoUsesPill ? '<span>Undo</span>' : '')
                      + '</button>'
                    : '';

                // Content composition by card type:
                //  Type 1 (1×1)     → name + XP only, no badges, no streak
                //  Type 3 (2×1) and
                //  Type 5 (1×2)    → name + XP + streak + alert badges only (no path)
                //  Type 4 (1×3) and
                //  Type 6 (2×2)    → all info incl. path breadcrumb + badges
                //  Type 7 (3×1)    → list-style: name + XP/streak/badges on one row
                //  Type 2 (3×2)    → full showcase (handled separately below)

                // Mini alert badges for compact types (3 and 5): only at-risk + multi-count + shield-0
                var miniAlerts = '';
                if (atRisk) miniAlerts += '<span class="gc-badge gc-badge-alert">⚠</span>';
                if (allowMulti && todayCount > 0) miniAlerts += '<span class="gc-badge gc-badge-multi">×' + todayCount + '</span>';
                if (currentStreak > 0 && shieldsLeft === 0 && shieldsUsed > 0) miniAlerts += '<span class="gc-badge gc-badge-skip">0 🛡</span>';

                // Full info badges for richer types (4, 6) — same content as `badges`
                // but include path breadcrumb.
                var richInfo = '<div class="gc-path">' + escapeHtml(activity.dimensionName) + ' › ' + escapeHtml(activity.pathName) + '</div>';

                var bodyContent;
                if (type === 2) {
                    // Type 2 (3×2): full showcase with all details — unchanged from before
                    var fullBadges = '';
                    fullBadges += '<span class="gc-badge gc-badge-counter" style="background:rgba(255,255,255,0.07);color:var(--color-text-secondary);">' + escapeHtml(activity.dimensionName) + ' › ' + escapeHtml(activity.pathName) + '</span>';
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
                        + '<div class="gc-badges" style="margin-top:5px;">' + fullBadges + '</div>';
                } else if (type === 7) {
                    // Type 7 (3×1): name top-left, XP+streak bottom-left, ring bottom-right
                    bodyContent = '<div class="gc-name">' + escapeHtml(activity.name) + '</div>'
                        + '<div class="gc-xp-row">'
                        + '<span class="gc-xp' + (activity.isNegative ? ' gc-xp-neg' : '') + '">' + xpText + ' XP</span>'
                        + (currentStreak > 0 ? '<span class="gc-streak">🔥 ' + currentStreak + '</span>' : '')
                        + miniAlerts
                        + '</div>';
                } else if (type === 1) {
                    // Type 1 (1×1): name + XP only — minimum info
                    bodyContent = '<div class="gc-name">' + escapeHtml(activity.name) + '</div>'
                        + '<div class="gc-xp-row">'
                        + '<span class="gc-xp' + (activity.isNegative ? ' gc-xp-neg' : '') + '">' + xpText + ' XP</span>'
                        + '</div>';
                } else if (type === 3 || type === 5) {
                    // Type 3 (2×1) / Type 5 (1×2): XP + streak + alerts only, no path
                    bodyContent = '<div class="gc-name">' + escapeHtml(activity.name) + '</div>'
                        + '<div class="gc-xp-row">'
                        + '<span class="gc-xp' + (activity.isNegative ? ' gc-xp-neg' : '') + '">' + xpText + ' XP</span>'
                        + (currentStreak > 0 ? '<span class="gc-streak">🔥 ' + currentStreak + '</span>' : '')
                        + miniAlerts
                        + '</div>';
                } else {
                    // Type 4 (1×3) / Type 6 (2×2): all info incl. path + full badges
                    bodyContent = '<div class="gc-name">' + escapeHtml(activity.name) + '</div>'
                        + richInfo
                        + '<div class="gc-xp-row">'
                        + '<span class="gc-xp' + (activity.isNegative ? ' gc-xp-neg' : '') + '">' + xpText + ' XP</span>'
                        + (currentStreak > 0 ? '<span class="gc-streak">🔥 ' + currentStreak + '</span>' : '')
                        + '</div>'
                        + (badges ? '<div class="gc-badges">' + badges + '</div>' : '');
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
                    + ' style="--dim-color:' + dimHex + ';--dim-rgba:rgba(' + dimRgb + ',0.36);"'
                    + pointerHandlers + '>'
                    + '<div class="gc-gradient"></div>'
                    + cornerUndoHtml
                    + '<div class="gc-body">' + bodyContent + '</div>'
                    + ringHtml
                    + '</div>';
            }

            // ── Render ─────────────────────────────────────────────────────
            // Outside the by-routine sort, render a single flat grid — groups
            // belong to that sort exclusively. Inside by-routine, each group
            // becomes a collapsible section with its OWN .activity-grid so the
            // dense auto-flow can't bleed cards across group boundaries (the
            // bug that put "Hi" on top of the "Other" header).

            if (!_showGroupsInGrid) {
                return '<div class="activity-grid">'
                    + activities.map(renderCard).join('')
                    + '</div>';
            }

            var html = '';

            groupOrder.forEach(function(gid) {
                var g = window._gridGroups[gid];
                if (!g) return;
                var acts = byGroup[gid] || [];
                var key = 'routine_' + gid;
                var stored = window.activityGroupExpanded[key];
                var isExpanded = (stored === undefined) ? !!g.isActive : (stored !== false);
                var timeBadge;
                if (g.timeStart && g.timeEnd) {
                    timeBadge = '<span class="routine-time-badge'
                        + (g.isActive ? ' active' : '') + '">'
                        + '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>'
                        + '<span>' + escapeHtml(formatTime12(g.timeStart)) + ' – '
                        + escapeHtml(formatTime12(g.timeEnd)) + '</span></span>';
                } else {
                    timeBadge = '<span class="routine-time-badge all-day">'
                        + '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/></svg>'
                        + '<span>All day</span></span>';
                }
                html += '<div class="act-group routine-group" data-group="' + key + '">'
                    + '<div class="act-group-header routine-group-header" onclick="toggleActivityGroup(\'' + key + '\')">'
                    + '<span class="collapse-icon ' + (isExpanded ? 'expanded' : '') + '" aria-hidden="true">'
                    + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>'
                    + '</span>'
                    + '<span class="act-group-label">' + escapeHtml(g.name || 'Group') + '</span>'
                    + timeBadge
                    + '<span class="act-group-count">' + acts.length + '</span>'
                    + '<button class="routine-edit-btn" onclick="event.stopPropagation();openGroupModal(\'' + gid + '\')" title="Edit group" aria-label="Edit group">'
                    + '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
                    + '</button>'
                    + '</div>'
                    + '<div class="act-group-body ' + (isExpanded ? 'expanded' : '') + '">'
                    + (acts.length
                        ? '<div class="activity-grid">' + acts.map(renderCard).join('') + '</div>'
                        : '<div class="routine-empty-inline">No activities in this group yet. <a href="#" onclick="event.preventDefault();openGroupModal(\'' + gid + '\')">Add some →</a></div>')
                    + '</div></div>';
            });

            // "Other" — ungrouped activities, collapsed by default so the
            // active routine stays the visual anchor on app open.
            if (ungrouped.length) {
                var ukey = 'routine_other';
                var uStored = window.activityGroupExpanded[ukey];
                var uExpanded = (uStored === true);
                html += '<div class="act-group" data-group="' + ukey + '">'
                    + '<div class="act-group-header" onclick="toggleActivityGroup(\'' + ukey + '\')">'
                    + '<span class="collapse-icon ' + (uExpanded ? 'expanded' : '') + '" aria-hidden="true">'
                    + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>'
                    + '</span>'
                    + '<span class="act-group-label">Other</span>'
                    + '<span class="act-group-count">' + ungrouped.length + '</span>'
                    + '</div>'
                    + '<div class="act-group-body ' + (uExpanded ? 'expanded' : '') + '">'
                    + '<div class="activity-grid">' + ungrouped.map(renderCard).join('') + '</div>'
                    + '</div></div>';
            }

            // Footer entry to add another group — matches the list view's
            // affordance so users have the same CTA regardless of view mode.
            html += '<div class="routine-add-row">'
                + '<button class="routine-add-btn" onclick="openGroupModal()">+ New group</button>'
                + '</div>';

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
        // Simple rising-text label — no chip surface, no flight path. Just
        // the XP delta floating up briefly above the activity that
        // triggered it. (Earlier we tried flying it to the progress bar,
        // but the visual ended up reading as a heavy pill rather than a
        // light "score popped" cue.)
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
            // Mark this activity as the "just-toggled" one so the renderer
            // only applies entry animations (ring-settle / undo slide-in)
            // to this specific card. Without this flag, every already-
            // completed card would re-animate on each render, which looked
            // like the whole list "jerks" whenever you tap a single card.
            window._justToggledActivityId = activityId;
            const data = window.userData;
            for (let dimIndex = 0; dimIndex < (data.dimensions || []).length; dimIndex++) {
                const dim = data.dimensions[dimIndex];
                for (let pathIndex = 0; pathIndex < (dim.paths || []).length; pathIndex++) {
                    const path = dim.paths[pathIndex];
                    const actIndex = (path.activities || []).findIndex(a => a.id === activityId);
                    if (actIndex !== -1) {
                        var _act = path.activities[actIndex];
                        // Same prediction completeActivity uses — drift impossible.
                        var _predEarned = predictCompletionXP(_act).earnedXP;
                        var _xpPreview  = (_act.isNegative && !_act.isSkipNegative) ? -_predEarned : _predEarned;
                        spawnFloatingXP(activityId, _xpPreview);
                        await completeActivity(dimIndex, pathIndex, actIndex);
                        return;
                    }
                }
            }
        };

        // Undo activity by ID (for flat activities view)
        window.undoActivityById = async function(activityId) {
            // Same "just-toggled" flag as completeActivityById — undo also
            // animates the card; nothing else should.
            window._justToggledActivityId = activityId;
            if (window._sessionCompleted) window._sessionCompleted.delete(activityId);
            const data = window.userData;
            
            // Find the activity
            for (let dimIndex = 0; dimIndex < (data.dimensions || []).length; dimIndex++) {
                const dim = data.dimensions[dimIndex];
                for (let pathIndex = 0; pathIndex < (dim.paths || []).length; pathIndex++) {
                    const path = dim.paths[pathIndex];
                    const actIndex = (path.activities || []).findIndex(a => a.id === activityId);
                    if (actIndex !== -1) {
                        // Show a negative XP indicator floating up from the card
                        // (simple rising text; same animation as the positive
                        // case but red).
                        var _act = path.activities[actIndex];
                        // Use the last recorded entry's XP — that's the exact
                        // bonus-adjusted amount that was originally awarded.
                        // Falls back to baseXP only if no history exists.
                        var _lastEntry = (_act.completionHistory || []).filter(function(e){ return !e.isPenalty; }).slice(-1)[0];
                        var _earnedXP  = _lastEntry ? Math.abs(_lastEntry.xp || 0) : (_act.baseXP || 0);
                        var _xpPreview = (_act.isNegative && !_act.isSkipNegative) ? _earnedXP : -_earnedXP;
                        spawnFloatingXP(activityId, _xpPreview);
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

            // Update header count pill — "N dimensions" / "1 dimension"
            const countEl = document.getElementById('catDimensionCount');
            if (countEl) {
                const n = dimensions.length;
                countEl.textContent = n === 0 ? '' : (n + ' ' + (n === 1 ? 'dimension' : 'dimensions'));
            }

            if (dimensions.length === 0 && uncActs.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">🎯</div>
                        <p>No dimensions yet. Tap <strong>+ Add Dimension</strong> above to create your first life area.</p>
                    </div>
                `;
                return;
            }

            // SVG primitives used multiple times — define once.
            const chevronSvg = `<svg class="cat-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;
            const expChevronSvg = `<svg class="cat-chevron expanded" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;
            const kebabSvg = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>`;
            const plusSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;

            const dimHtml = dimensions.map((dim) => {
                const dimIndex = allDimensions.indexOf(dim);
                const dimHex = (typeof DIM_HEX_MAP !== 'undefined' && DIM_HEX_MAP[dim.color]) || '#5a9fd4';
                const pathCount = (dim.paths || []).length;
                const actCount = countDimensionActivities(dim);
                const meta = `${pathCount} ${pathCount === 1 ? 'path' : 'paths'} · ${actCount} ${actCount === 1 ? 'activity' : 'activities'}`;
                return `
                <div class="cat-dim-card" style="--cat-dim-color:${dimHex};" data-dim-index="${dimIndex}">
                    <div class="cat-dim-head" onclick="toggleDimension(${dimIndex})">
                        ${dim.expanded ? expChevronSvg : chevronSvg}
                        <div class="cat-dim-textcol">
                            <div class="cat-dim-name">${escapeHtml(dim.name)}</div>
                            <div class="cat-dim-meta">${meta}</div>
                        </div>
                        <div class="cat-row-actions" onclick="event.stopPropagation()">
                            <button class="cat-add-inline" onclick="openPathModal(${dimIndex})" title="Add path">
                                ${plusSvg}<span class="cat-add-inline-label">Path</span>
                            </button>
                            <button class="cat-kebab" onclick="openCatActionMenu('dim',${dimIndex})" aria-label="More options">${kebabSvg}</button>
                        </div>
                    </div>
                    <div class="cat-dim-body${dim.expanded ? ' expanded' : ''}">
                        ${renderPaths(dim.paths || [], dimIndex, dimHex)}
                    </div>
                </div>`;
            }).join('');

            // Uncategorized section — same primitives, dashed treatment
            let uncHtml = '';
            if (uncActs.length > 0) {
                const uncDimIndex = allDimensions.indexOf(uncDim);
                const uncPathIndex = uncDim.paths.findIndex(p => p.id === 'uncategorized');
                const actRows = renderCategoriesActivities(uncActs, uncDimIndex, uncPathIndex, '#888888');
                uncHtml = `
                <div class="cat-dim-card cat-uncategorized">
                    <div class="cat-dim-head" style="cursor:default;">
                        <span style="width:14px;flex-shrink:0;"></span>
                        <div class="cat-dim-textcol">
                            <div class="cat-dim-name">📥 Uncategorized</div>
                            <div class="cat-dim-meta">${uncActs.length} ${uncActs.length === 1 ? 'activity' : 'activities'} · assign a Dimension &amp; Path to organise</div>
                        </div>
                    </div>
                    <div class="cat-dim-body expanded">
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

        function renderPaths(paths, dimIndex, dimHex) {
            if (paths.length === 0) {
                return '<div class="cat-empty">No paths yet · use <strong>+ Path</strong> above</div>';
            }

            const chevronSvg = `<svg class="cat-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;
            const expChevronSvg = `<svg class="cat-chevron expanded" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;
            const kebabSvg = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>`;
            const plusSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;

            return paths.map((path, pathIndex) => {
                const actCount = (path.activities || []).length;
                return `
                <div class="cat-path-card" data-path-index="${pathIndex}">
                    <div class="cat-path-head" onclick="togglePath(${dimIndex}, ${pathIndex})">
                        ${path.expanded ? expChevronSvg : chevronSvg}
                        <div class="cat-path-textcol">
                            <div class="cat-path-name">${escapeHtml(path.name)}</div>
                            <div class="cat-path-meta">${actCount} ${actCount === 1 ? 'activity' : 'activities'}</div>
                        </div>
                        <div class="cat-row-actions" onclick="event.stopPropagation()">
                            <button class="cat-add-inline" onclick="openActivityModal(${dimIndex}, ${pathIndex})" title="Add activity">
                                ${plusSvg}<span class="cat-add-inline-label">Activity</span>
                            </button>
                            <button class="cat-kebab" onclick="openCatActionMenu('path',${dimIndex},${pathIndex})" aria-label="More options">${kebabSvg}</button>
                        </div>
                    </div>
                    <div class="cat-path-body${path.expanded ? ' expanded' : ''}">
                        ${renderCategoriesActivities(path.activities || [], dimIndex, pathIndex, dimHex)}
                    </div>
                </div>`;
            }).join('');
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
            grp.style.display = newActive ? 'flex' : 'none';
            if (btn) btn.classList.toggle('active', newActive);
            if (check) check.textContent = newActive ? '✓' : '';
            // Keep the new switch UI in sync
            const proxy = document.getElementById('challengeMetricEnabledProxy');
            if (proxy) proxy.checked = newActive;
        };

        // ── v122 toggle proxies — drive the new ay-toggle-row switches ─────
        // The underlying hidden checkbox / hidden input is what saveChallenge
        // reads, so we keep them as the source of truth and just keep the
        // visible switch in sync.
        window.setChallengeMetricEnabled = function(checked) {
            const hiddenInput = document.getElementById('challengeMetricEnabled');
            const grp = document.getElementById('challengeMetricGroup');
            if (!hiddenInput || !grp) return;
            hiddenInput.value = checked ? '1' : '0';
            grp.style.display = checked ? 'flex' : 'none';
        };
        window.setChallengeEnforceActivities = function(checked) {
            const cb = document.getElementById('challengeEnforceActivities');
            if (cb) cb.checked = checked;
        };
        window.setChallengeEnforceDateRange = function(checked) {
            const cb = document.getElementById('challengeEnforceDateRange');
            if (cb) cb.checked = checked;
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
                document.getElementById('challengeMetricGroup').style.display = metricEnabled ? 'flex' : 'none';
                if (metricEnabled) {
                    document.getElementById('challengeMetricQty').value = challenge.metricQty;
                    document.getElementById('challengeMetricUnit').value = challenge.metricUnit;
                }
                // v122: sync new proxy switches
                const _pE = document.getElementById('challengeEnforceActivitiesProxy');
                const _pD = document.getElementById('challengeEnforceDateRangeProxy');
                const _pM = document.getElementById('challengeMetricEnabledProxy');
                if (_pE) _pE.checked = !!(challenge.enforceActivities);
                if (_pD) _pD.checked = !!(challenge.enforceDateRange);
                if (_pM) _pM.checked = metricEnabled;
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
                // v122: sync new proxy switches to OFF
                const _pE2 = document.getElementById('challengeEnforceActivitiesProxy');
                const _pD2 = document.getElementById('challengeEnforceDateRangeProxy');
                const _pM2 = document.getElementById('challengeMetricEnabledProxy');
                if (_pE2) _pE2.checked = false;
                if (_pD2) _pD2.checked = false;
                if (_pM2) _pM2.checked = false;
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
            const proxy = document.getElementById('challengeEnforceActivitiesProxy');
            if (proxy) proxy.checked = cb.checked;
        };

        window.toggleChallengeEnforceDateRange = function() {
            const cb = document.getElementById('challengeEnforceDateRange');
            const btn = document.getElementById('enforceDateRangeBtn');
            const check = document.getElementById('enforceDateRangeCheck');
            if (!cb) return;
            cb.checked = !cb.checked;
            btn?.classList.toggle('active', cb.checked);
            if (check) check.textContent = cb.checked ? '✓' : '';
            const proxy = document.getElementById('challengeEnforceDateRangeProxy');
            if (proxy) proxy.checked = cb.checked;
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

        // ══════════════════════════════════════════════════════════════════
        // ── Quests — project dashboards for multi-step planning ───────────
        // ══════════════════════════════════════════════════════════════════
        // A Quest is a thing-to-be-finished (ship a video, plan a trip),
        // distinct from an Activity (repeats forever, streak-driven) and a
        // Challenge (aggregate counter over activities). It holds TASKS
        // (dated, describable, activity-linkable, XP-carrying) which hold
        // SUBTASKS (simple checklist items). Completion is user-declared.
        // A repeating quest is ONE object mutated in place: Declare Done
        // bumps completedCount and resets the checklist for the next period;
        // task dates shift in lockstep with the period.

        function getQuests() {
            if (!Array.isArray(window.userData.quests)) window.userData.quests = [];
            return window.userData.quests;
        }
        function findQuestById(questId) {
            return getQuests().find(function(q) { return q.id === questId; }) || null;
        }
        function findQuestTask(q, taskId) {
            return ((q && q.tasks) || []).find(function(t) { return t.id === taskId; }) || null;
        }
        // Progress = done tasks / total tasks. Subtasks are a checklist
        // INSIDE a task and never complete their parent automatically.
        function questProgress(q) {
            var total = (q.tasks || []).length;
            var done = (q.tasks || []).filter(function(t) { return t.done; }).length;
            return { done: done, total: total, pct: total ? Math.round(done / total * 100) : 0 };
        }
        // Task display title: linked tasks fall back to the activity name
        // when their own title is blank.
        function questTaskTitle(t) {
            if (t.title) return t.title;
            if (t.activityId) {
                var e = ttFindActivity(t.activityId);
                if (e) return e.activity.name;
            }
            return 'Untitled task';
        }

        // ── v1 → v2 migration (idempotent; keyed off missing tasks[]) ─────
        // v1 quests had flat subtasks[] ({type:'task'|'activity', window})
        // and recurrence {cadence}. v2 has tasks[] (with own subtasks[],
        // start/due dates) and repeat {every, unit}.
        function migrateQuestsV2() {
            if (!window.userData || !Array.isArray(window.userData.quests)) return;
            var changed = false;
            window.userData.quests.forEach(function(q) {
                if (Array.isArray(q.tasks)) return; // already v2
                q.tasks = (q.subtasks || []).map(function(s, i) {
                    var title = s.title || '';
                    if (s.type === 'activity' && !title) {
                        var e = ttFindActivity(s.activityId);
                        title = e ? e.activity.name : 'Linked activity';
                    }
                    return {
                        id: s.id || ('t_' + Date.now().toString(36) + '_' + i),
                        title: title, description: '',
                        activityId: s.type === 'activity' ? (s.activityId || null) : null,
                        xp: s.xp || null,
                        startDate: (s.window && s.window.start) || null,
                        dueDate: (s.window && (s.window.end || s.window.start)) || null,
                        done: !!s.done, doneAt: s.doneAt || null, doneVia: s.doneVia || null,
                        subtasks: [], order: i
                    };
                });
                delete q.subtasks;
                if (q.recurrence) {
                    q.repeat = {
                        every: 1,
                        unit: q.recurrence.cadence === 'monthly' ? 'month' : 'week',
                        periodStart: q.recurrence.periodStart || localToday()
                    };
                    delete q.recurrence;
                } else if (q.repeat === undefined) {
                    q.repeat = null;
                }
                if (q.description === undefined) q.description = '';
                changed = true;
            });
            if (changed) saveUserData().catch(function() {});
        }

        // Shared global-XP delta with level-up/level-down handling — the same
        // math completeChallenge/undoChallenge use, factored so quest subtask
        // XP, quest bonus XP, and their undos share one code path.
        function applyBonusXP(delta) {
            if (!delta) return;
            window.userData.currentXP += delta;
            window.userData.totalXP += delta;
            if (delta > 0) {
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
            } else {
                while (window.userData.currentXP < 0 && window.userData.level > 1) {
                    window.userData.level -= 1;
                    window.userData.currentXP += calculateXPForLevel(window.userData.level);
                }
                if (window.userData.currentXP < 0) window.userData.currentXP = 0;
            }
        }

        // ── Repeat (any window: every N days/weeks/months) ────────────────
        function questAdvancePeriod(dateStr, repeat) {
            var parts = (dateStr || localToday()).split('-').map(Number);
            var d = new Date(parts[0], parts[1] - 1, parts[2]);
            var n = Math.max(1, (repeat && repeat.every) | 0 || 1);
            if (repeat.unit === 'month') {
                // Clamp to end of target month so Jan 31 → Feb 28, not Mar 3
                var day = d.getDate();
                d.setDate(1);
                d.setMonth(d.getMonth() + n);
                var maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
                d.setDate(Math.min(day, maxDay));
            } else {
                d.setDate(d.getDate() + n * (repeat.unit === 'week' ? 7 : 1));
            }
            return toLocalDateStr(d);
        }
        function questDaysBetween(fromStr, toStr) {
            return Math.round((new Date(toStr + 'T12:00:00') - new Date(fromStr + 'T12:00:00')) / 86400000);
        }
        // Task dates are relative to the current cycle: whenever periodStart
        // moves, every dated task shifts by the same day-delta so the plan
        // stays aligned with the new cycle instead of going permanently
        // overdue. (Undo restores dates from the snapshot — the month clamp
        // makes the shift non-invertible.)
        function questShiftTaskDates(q, fromStr, toStr) {
            var delta = questDaysBetween(fromStr, toStr);
            if (!delta) return;
            (q.tasks || []).forEach(function(t) {
                ['startDate', 'dueDate'].forEach(function(k) {
                    if (!t[k]) return;
                    var p = t[k].split('-').map(Number);
                    var d = new Date(p[0], p[1] - 1, p[2]);
                    d.setDate(d.getDate() + delta);
                    t[k] = toLocalDateStr(d);
                });
            });
        }
        // Login rollover: if a repeating quest's period elapsed without a
        // completion, advance periodStart (and shift task dates in lockstep)
        // WITHOUT wiping in-progress checkmarks — only Declare Done resets.
        function processQuestRepeat() {
            var today = localToday();
            var changed = false;
            getQuests().forEach(function(q) {
                if (!q.repeat || q.status !== 'active') return;
                var guard = 0;
                var next = questAdvancePeriod(q.repeat.periodStart, q.repeat);
                while (next <= today && guard++ < 500) {
                    questShiftTaskDates(q, q.repeat.periodStart, next);
                    q.repeat.periodStart = next;
                    next = questAdvancePeriod(next, q.repeat);
                    changed = true;
                }
            });
            if (changed) saveUserData().catch(function() {});
        }

        // ── Quests tab (Activities → Quests sub-tab) ─────────────────────
        // Dispatches between the overview (Mode B inventory of quest cards)
        // and a single quest's dashboard (swap-in-place on _openQuestId).
        function renderQuestsTab() {
            var container = document.getElementById('questsContainer');
            if (!container) return;
            if (window._openQuestId) {
                var openQ = findQuestById(window._openQuestId);
                if (openQ) { container.innerHTML = renderQuestDashboard(openQ); return; }
                window._openQuestId = null;
            }
            renderQuestsOverview(container);
        }

        function renderQuestsOverview(container) {
            var quests = getQuests();
            if (quests.length === 0) {
                // Onboarding-empty: CTA + copy explaining the first action
                container.innerHTML = `
                    <div class="empty-state" style="padding: 60px 20px;">
                        <div class="empty-state-icon">${ttIcon('flag', 30)}</div>
                        <p style="font-size:16px;font-weight:600;color:var(--color-text-primary);margin-bottom:8px;">Every big thing is a series of small steps.</p>
                        <p style="margin-bottom:24px;">A Quest turns one goal — a video, a trip, a launch — into a plan you can actually finish.</p>
                        <button class="cta-button" onclick="openQuestModal()">Create your first Quest</button>
                    </div>`;
                return;
            }
            var active = quests.filter(function(q) { return q.status === 'active'; });
            var completed = quests.filter(function(q) { return q.status === 'completed'; });

            // Hero = most urgent active quest: nearest deadline first, else newest
            var hero = active.slice().sort(function(a, b) {
                if (a.deadline && b.deadline) return a.deadline < b.deadline ? -1 : 1;
                if (a.deadline) return -1;
                if (b.deadline) return 1;
                return (b.createdAt || '') < (a.createdAt || '') ? -1 : 1;
            })[0] || null;

            var html = '<div class="quest-header-row">'
                + '<button class="routine-add-btn" onclick="openQuestModal()">+ New Quest</button>'
                + '</div>';
            if (hero) html += renderQuestCard(hero, true);
            html += active.filter(function(q) { return !hero || q.id !== hero.id; }).map(function(q) { return renderQuestCard(q, false); }).join('');
            if (completed.length) {
                if (window.activityGroupExpanded['quests_done'] === undefined) window.activityGroupExpanded['quests_done'] = false;
                var isExp = window.activityGroupExpanded['quests_done'] === true;
                var chev = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';
                html += '<div class="act-group" data-group="quests_done">'
                    + '<div class="act-group-header" onclick="toggleActivityGroup(\'quests_done\'); renderQuestsTab();">'
                    + '<span class="collapse-icon ' + (isExp ? 'expanded' : '') + '" aria-hidden="true">' + chev + '</span>'
                    + '<span class="act-group-label">Completed</span>'
                    + '<span class="act-group-count">' + completed.length + '</span>'
                    + '</div>'
                    + '<div class="act-group-body ' + (isExp ? 'expanded' : '') + '">'
                    + completed.map(function(q) { return renderQuestCard(q, false); }).join('')
                    + '</div></div>';
            }
            container.innerHTML = html;
        }

        function questDeadlineChip(q) {
            if (!q.deadline || q.status !== 'active') return '';
            var msLeft = new Date(q.deadline + 'T23:59:59') - new Date();
            var daysLeft = Math.ceil(msLeft / 86400000);
            if (daysLeft < 0) return '<span class="quest-chip-warn">Overdue</span>';
            if (daysLeft <= 3) return '<span class="quest-chip-warn">' + daysLeft + 'd left</span>';
            return '<span class="quest-meta-text">Due ' + escapeHtml(questFmtDate(q.deadline)) + '</span>';
        }

        // "Jul 14" — short human date from YYYY-MM-DD (local, no TZ surprises)
        function questFmtDate(dateStr) {
            if (!dateStr) return '';
            var p = dateStr.split('-').map(Number);
            var d = new Date(p[0], p[1] - 1, p[2]);
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        }

        // Repeat-cycle chip copy: "Every 2 weeks · 5 shipped" (card) or
        // "Day 4 of 14 · 5 shipped" (dashboard, positional)
        function questRepeatLabel(q, positional) {
            if (!q.repeat) {
                return q.completedCount > 1 ? q.completedCount + ' shipped' : '';
            }
            var n = q.repeat.every || 1;
            var unit = q.repeat.unit || 'week';
            var label;
            if (positional) {
                var lenDays = { day: n, week: n * 7, month: n * 30 }[unit] || n * 7;
                var elapsed = Math.floor((new Date(localToday() + 'T12:00:00') - new Date((q.repeat.periodStart || localToday()) + 'T12:00:00')) / 86400000);
                elapsed = Math.max(0, Math.min(elapsed, lenDays - 1));
                label = 'Day ' + (elapsed + 1) + ' of ' + lenDays;
            } else {
                label = n === 1 ? ('Every ' + unit) : ('Every ' + n + ' ' + unit + 's');
            }
            if (q.completedCount) label += ' · ' + q.completedCount + ' shipped';
            return label;
        }

        function renderQuestCard(q, isHero) {
            var prog = questProgress(q);
            var repeatTxt = questRepeatLabel(q, false);
            var recurChip = repeatTxt
                ? '<span class="quest-recur-chip">' + (q.repeat ? ttIcon('refresh', 10) + ' ' : '') + escapeHtml(repeatTxt) + '</span>'
                : '';
            var doneCls = q.status === 'completed' ? ' quest-card-done' : '';
            var heroCls = isHero ? ' qo-hero' : '';
            var nextUp = '';
            if (isHero) {
                // First undone task, dated ones first
                var undone = (q.tasks || []).filter(function(t) { return !t.done; });
                undone.sort(function(a, b) {
                    var ka = a.dueDate || a.startDate || '9999';
                    var kb = b.dueDate || b.startDate || '9999';
                    return ka < kb ? -1 : ka > kb ? 1 : (a.order || 0) - (b.order || 0);
                });
                if (undone[0]) {
                    nextUp = '<div class="qo-next"><span class="qo-next-kicker">Next up</span>'
                        + '<span class="qo-next-title">' + escapeHtml(questTaskTitle(undone[0])) + '</span></div>';
                }
            }
            return '<div class="quest-card' + heroCls + doneCls + '" onclick="openQuestDashboard(\'' + q.id + '\')">'
                + '<div class="quest-card-top">'
                + '<span class="quest-card-name">' + escapeHtml(q.name) + '</span>'
                + questDeadlineChip(q)
                + '</div>'
                + nextUp
                + '<div class="quest-card-meta">'
                + '<span class="quest-meta-text">' + prog.done + '/' + prog.total + ' tasks</span>'
                + recurChip
                + '</div>'
                + '<div class="quest-bar"><div class="quest-bar-inner" style="width:' + prog.pct + '%;"></div></div>'
                + '</div>';
        }

        window.openQuestDashboard = function(questId) {
            window._openQuestId = questId;
            renderQuestsTab();
        };
        window.closeQuestDashboard = function() {
            window._openQuestId = null;
            renderQuestsTab();
        };
        // Entry from the Today quest-window strip: route to the Quests
        // sub-tab and open the quest's dashboard.
        window.openQuestFromToday = function(questId) {
            window._openQuestId = questId;
            switchTab('activities');
            switchSubTab('activities', 'quests');
        };

        // ── Quest dashboard — the project surface ─────────────────────────
        function renderQuestDashboard(q) {
            var prog = questProgress(q);
            var view = window._questView || 'timeline';

            var chips = [];
            var dChip = questDeadlineChip(q);
            if (dChip) chips.push(dChip);
            if (q.repeat) {
                chips.push('<span class="quest-recur-chip">' + ttIcon('refresh', 10) + ' '
                    + escapeHtml(questRepeatLabel(q, true)) + '</span>');
            } else if (q.completedCount > 1) {
                chips.push('<span class="quest-recur-chip">' + q.completedCount + ' shipped</span>');
            }
            chips.push('<span class="quest-meta-text">' + prog.done + '/' + prog.total + ' tasks</span>');

            var chevLeft = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';

            var body;
            if ((q.tasks || []).length === 0) {
                // Onboarding-empty for a fresh quest: the first action is
                // breaking the goal into tasks.
                body = '<div class="empty-state" style="padding:36px 20px;">'
                    + '<p style="font-size:14.5px;font-weight:600;color:var(--color-text-primary);margin-bottom:6px;">Break it into tasks.</p>'
                    + '<p style="margin-bottom:18px;font-size:12.5px;">Big goals get done as small steps. Add the first one.</p>'
                    + '</div>';
            } else if (view === 'list') {
                body = renderQuestTaskList(q);
            } else {
                body = renderQuestTimeline(q);
            }

            var footer;
            if (q.status === 'completed') {
                footer = '<button class="btn-secondary pl-btn-secondary" style="width:100%;" onclick="undoQuestCompletion(\'' + q.id + '\')">Undo completion</button>';
            } else {
                footer = '<button class="quest-declare-done" onclick="completeQuest(\'' + q.id + '\')">Declare Done'
                    + (q.bonusXP ? ' &nbsp;&middot;&nbsp; +' + q.bonusXP + ' XP' : '') + '</button>';
            }

            return '<div class="qd">'
                + '<button class="qd-back" onclick="closeQuestDashboard()">' + chevLeft + ' Quests</button>'
                + '<div class="qd-hero">'
                + '<div class="qd-hero-top">'
                + '<h2 class="qd-name">' + escapeHtml(q.name) + '</h2>'
                + '<button class="qd-edit" onclick="openQuestModal(\'' + q.id + '\')" title="Edit quest" aria-label="Edit quest">' + ttIcon('edit', 13) + '</button>'
                + '</div>'
                + (q.description ? '<p class="qd-desc">' + escapeHtml(q.description) + '</p>' : '')
                + '<div class="qd-hero-meta">' + chips.join('') + '</div>'
                + '<div class="qd-hero-bar"><div class="quest-bar"><div class="quest-bar-inner" style="width:' + prog.pct + '%;"></div></div>'
                + '<span class="qd-pct">' + prog.pct + '%</span></div>'
                + '</div>'
                + '<div class="qd-viewtoggle" role="tablist">'
                + '<button class="qd-vt' + (view === 'timeline' ? ' active' : '') + '" onclick="setQuestView(\'timeline\')">Timeline</button>'
                + '<button class="qd-vt' + (view === 'list' ? ' active' : '') + '" onclick="setQuestView(\'list\')">List</button>'
                + '</div>'
                + '<div class="qd-body">' + body + '</div>'
                + '<button class="qd-addtask" onclick="openTaskEditor(\'' + q.id + '\', null)">' + ttIcon('plus', 12) + ' Add task</button>'
                + '<div class="qd-footer">' + footer + '</div>'
                + '<div class="quest-detail-actions">'
                + '<button class="btn-secondary pl-btn-secondary" onclick="openQuestModal(\'' + q.id + '\')">Edit</button>'
                + '<button class="btn-secondary pl-btn-secondary quest-delete-btn" onclick="deleteQuest(\'' + q.id + '\')">Delete</button>'
                + '</div>'
                + '</div>';
        }

        window.setQuestView = function(view) {
            window._questView = view === 'list' ? 'list' : 'timeline';
            renderQuestsTab();
        };

        // Timeline marker text: "TODAY · JUL 11" / "MON · JUL 14"
        function questTlMarker(dateStr, today) {
            if (dateStr === today) return 'Today · ' + questFmtDate(dateStr);
            var p = dateStr.split('-').map(Number);
            var d = new Date(p[0], p[1] - 1, p[2]);
            var wd = d.toLocaleDateString(undefined, { weekday: 'short' });
            return wd + ' · ' + questFmtDate(dateStr);
        }

        // Vertical project timeline. Groups keyed by dueDate||startDate,
        // chronological; undone past-due tasks pool in OVERDUE at top; a
        // today-line sits at the temporal boundary; undated tasks live in
        // ANYTIME at the bottom. Done past tasks stay in their date groups
        // (dimmed) so history reads intact.
        function renderQuestTimeline(q) {
            var today = localToday();
            var overdue = [];
            var dated = {};
            var anytime = [];
            (q.tasks || []).forEach(function(t) {
                var key = t.dueDate || t.startDate;
                if (!key) { anytime.push(t); return; }
                if (!t.done && t.dueDate && t.dueDate < today) { overdue.push(t); return; }
                (dated[key] = dated[key] || []).push(t);
            });
            var byOrder = function(a, b) { return (a.order || 0) - (b.order || 0); };
            overdue.sort(function(a, b) { return (a.dueDate || '') < (b.dueDate || '') ? -1 : 1; });
            anytime.sort(byOrder);

            var keys = Object.keys(dated).sort();
            var html = '';
            if (overdue.length) {
                html += '<div class="qd-tl-group is-overdue">'
                    + '<div class="qd-tl-marker warn">Overdue</div>'
                    + overdue.map(function(t) { return renderQuestTaskRow(q, t, true); }).join('')
                    + '</div>';
            }
            var todayLinePlaced = false;
            var todayLine = '<div class="qd-tl-today"><span>' + escapeHtml('Today · ' + questFmtDate(today)) + '</span></div>';
            keys.forEach(function(key) {
                if (!todayLinePlaced && key >= today) {
                    if (key !== today) html += todayLine;
                    todayLinePlaced = true;
                }
                var isPast = key < today;
                var isToday = key === today;
                html += '<div class="qd-tl-group' + (isPast ? ' is-past' : '') + (isToday ? ' is-today' : '') + '">'
                    + '<div class="qd-tl-marker' + (isToday ? ' today' : '') + '">' + escapeHtml(questTlMarker(key, today)) + '</div>'
                    + dated[key].sort(byOrder).map(function(t) { return renderQuestTaskRow(q, t, true); }).join('')
                    + '</div>';
            });
            if (!todayLinePlaced && keys.length) html += todayLine;
            if (anytime.length) {
                html += '<div class="qd-tl-group is-anytime">'
                    + '<div class="qd-tl-marker">Anytime</div>'
                    + anytime.map(function(t) { return renderQuestTaskRow(q, t, true); }).join('')
                    + '</div>';
            }
            return '<div class="qd-tl">' + html + '</div>';
        }

        function renderQuestTaskList(q) {
            var tasks = (q.tasks || []).slice().sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
            return '<div class="qd-list">' + tasks.map(function(t) { return renderQuestTaskRow(q, t, false); }).join('') + '</div>';
        }

        function renderQuestTaskRow(q, t, onRail) {
            var today = localToday();
            var expanded = window._qdExpandedTasks && window._qdExpandedTasks.has(t.id);
            var isOverdue = !t.done && t.dueDate && t.dueDate < today;
            var linked = t.activityId ? ttFindActivity(t.activityId) : null;

            var meta = [];
            if (t.startDate || t.dueDate) {
                var dateTxt = t.startDate && t.dueDate && t.startDate !== t.dueDate
                    ? questFmtDate(t.startDate) + ' → ' + questFmtDate(t.dueDate)
                    : questFmtDate(t.dueDate || t.startDate);
                meta.push('<span class="quest-meta-text' + (isOverdue ? ' qd-overdue-text' : '') + '">' + escapeHtml(dateTxt) + '</span>');
            }
            if (t.xp && !t.activityId) meta.push('<span class="quest-xp-text">+' + t.xp + ' XP</span>');
            if ((t.subtasks || []).length) {
                var sd = t.subtasks.filter(function(s) { return s.done; }).length;
                meta.push('<span class="quest-meta-text">' + sd + '/' + t.subtasks.length + ' ' + ttIcon('check', 9) + '</span>');
            }
            if (linked && linked.activity.name !== questTaskTitle(t)) {
                // Skip when redundant with the row title (brief: cut redundancy)
                meta.push('<span class="quest-meta-text"><span class="tt-prereq-dot" style="background:' + ttDimHexRaw(linked.dim.id) + ';"></span> '
                    + escapeHtml(linked.activity.name) + '</span>');
            }

            var checkSvg = t.done
                ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
                : '';
            var chev = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

            var accent = linked ? ' style="border-left:2px solid ' + ttDimHexRaw(linked.dim.id) + ';"' : '';
            var dot = onRail ? '<span class="qd-tl-dot' + (linked ? '" style="border-color:' + ttDimHexRaw(linked.dim.id) + ';' : '') + '"></span>' : '';

            var row = '<div class="qd-task' + (t.done ? ' done' : '') + (isOverdue ? ' overdue' : '') + '"' + accent + ' data-task="' + t.id + '">'
                + dot
                + '<button class="qd-check" onclick="toggleQuestTask(\'' + q.id + '\',\'' + t.id + '\')" aria-label="Toggle task">' + checkSvg + '</button>'
                + '<div class="qd-task-main" onclick="toggleTaskExpand(\'' + t.id + '\')">'
                + '<span class="qd-task-title">' + escapeHtml(questTaskTitle(t)) + '</span>'
                + (meta.length ? '<div class="qd-task-meta">' + meta.join('') + '</div>' : '')
                + '</div>'
                + '<span class="qd-task-chev' + (expanded ? ' expanded' : '') + '" onclick="toggleTaskExpand(\'' + t.id + '\')">' + chev + '</span>'
                + '</div>';

            if (expanded) {
                var subs = (t.subtasks || []).map(function(s) {
                    return '<div class="qd-sub' + (s.done ? ' done' : '') + '" onclick="toggleQuestSubtask(\'' + q.id + '\',\'' + t.id + '\',\'' + s.id + '\')">'
                        + '<span class="qd-sub-check">' + (s.done
                            ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
                            : '') + '</span>'
                        + '<span class="qd-sub-title">' + escapeHtml(s.title) + '</span>'
                        + '</div>';
                }).join('');
                row += '<div class="qd-task-body">'
                    + (t.description ? '<p class="qd-task-desc">' + escapeHtml(t.description) + '</p>' : '')
                    + subs
                    + '<form class="qd-sub-addrow" onsubmit="addQuestSubtaskInline(event,\'' + q.id + '\',\'' + t.id + '\')">'
                    + '<input type="text" class="pl-input" placeholder="Add a subtask" maxlength="120">'
                    + '</form>'
                    + '<button class="qd-task-editbtn" onclick="openTaskEditor(\'' + q.id + '\',\'' + t.id + '\')">' + ttIcon('edit', 11) + ' Edit task</button>'
                    + '</div>';
            }
            return row;
        }

        // ── Task & subtask interactions ───────────────────────────────────
        window.toggleTaskExpand = function(taskId) {
            if (!window._qdExpandedTasks) window._qdExpandedTasks = new Set();
            if (window._qdExpandedTasks.has(taskId)) window._qdExpandedTasks.delete(taskId);
            else window._qdExpandedTasks.add(taskId);
            renderQuestsTab();
        };

        window.toggleQuestTask = function(questId, taskId) {
            var q = findQuestById(questId);
            if (!q || q.status !== 'active') return;
            var t = findQuestTask(q, taskId);
            if (!t) return;
            t.done = !t.done;
            t.doneAt = t.done ? new Date().toISOString() : null;
            t.doneVia = t.done ? 'manual' : null;
            if (t.xp && !t.activityId) {
                applyBonusXP(t.done ? t.xp : -t.xp);
                showToast(t.done ? '+' + t.xp + ' XP' : '−' + t.xp + ' XP returned', t.done ? 'green' : 'olive');
                updateDashboard();
            }
            debouncedSaveUserData();
            renderQuestsTab();
        };

        window.toggleQuestSubtask = function(questId, taskId, subId) {
            var q = findQuestById(questId);
            if (!q || q.status !== 'active') return;
            var t = findQuestTask(q, taskId);
            var s = t && (t.subtasks || []).find(function(x) { return x.id === subId; });
            if (!s) return;
            s.done = !s.done;
            debouncedSaveUserData();
            renderQuestsTab();
        };

        window.addQuestSubtaskInline = function(event, questId, taskId) {
            event.preventDefault();
            var input = event.target.querySelector('input');
            var title = (input && input.value || '').trim();
            if (!title) return;
            var q = findQuestById(questId);
            var t = q && findQuestTask(q, taskId);
            if (!t) return;
            if (!Array.isArray(t.subtasks)) t.subtasks = [];
            t.subtasks.push({ id: 's_' + Date.now().toString(36), title: title, done: false });
            debouncedSaveUserData();
            renderQuestsTab();
        };

        // Completing a linked activity checks matching quest tasks; the
        // activity-undo path unchecks only ones checked that way today.
        function updateQuestProgressForActivity(activityId) {
            var touched = false;
            getQuests().forEach(function(q) {
                if (q.status !== 'active') return;
                (q.tasks || []).forEach(function(t) {
                    if (t.activityId === activityId && !t.done) {
                        t.done = true;
                        t.doneAt = new Date().toISOString();
                        t.doneVia = 'activity';
                        touched = true;
                    }
                });
            });
            return touched;
        }
        function undoQuestProgressForActivity(activityId) {
            var today = localToday();
            var touched = false;
            getQuests().forEach(function(q) {
                if (q.status !== 'active') return;
                (q.tasks || []).forEach(function(t) {
                    if (t.activityId === activityId && t.done
                        && t.doneVia === 'activity' && t.doneAt && toLocalDateStr(new Date(t.doneAt)) === today) {
                        t.done = false;
                        t.doneAt = null;
                        t.doneVia = null;
                        touched = true;
                    }
                });
            });
            return touched;
        }

        // Activity deleted → unlink referencing tasks in place; the task's
        // own title, checkmark, and history all survive.
        function cleanupQuestsForActivity(actId) {
            getQuests().forEach(function(q) {
                (q.tasks || []).forEach(function(t) {
                    if (t.activityId === actId) {
                        if (!t.title) t.title = questTaskTitle(t);
                        t.activityId = null;
                    }
                });
            });
        }

        // ── Declare Done / undo ───────────────────────────────────────────
        window.completeQuest = async function(questId) {
            var q = findQuestById(questId);
            if (!q || q.status !== 'active') return;
            var prog = questProgress(q);
            var msg = 'Declare "' + q.name + '" done?'
                + (prog.done < prog.total ? '\n(' + (prog.total - prog.done) + ' tasks are still unchecked — your call, it\'s your quest.)' : '')
                + (q.bonusXP ? '\nYou\'ll earn ' + q.bonusXP + ' XP.' : '');
            if (!confirm(msg)) return;
            if (q.repeat) {
                // Session-scoped undo snapshot — includes task dates because
                // the period shift is not invertible (month clamping).
                window._lastQuestCompletion = {
                    questId: q.id,
                    periodStart: q.repeat.periodStart,
                    taskState: (q.tasks || []).map(function(t) {
                        return { id: t.id, done: t.done, doneAt: t.doneAt, doneVia: t.doneVia,
                                 startDate: t.startDate, dueDate: t.dueDate,
                                 subDone: (t.subtasks || []).map(function(s) { return { id: s.id, done: s.done }; }) };
                    })
                };
                q.completedCount = (q.completedCount || 0) + 1;
                (q.tasks || []).forEach(function(t) {
                    t.done = false; t.doneAt = null; t.doneVia = null;
                    (t.subtasks || []).forEach(function(s) { s.done = false; });
                });
                var oldStart = q.repeat.periodStart;
                q.repeat.periodStart = questAdvancePeriod(q.repeat.periodStart, q.repeat);
                questShiftTaskDates(q, oldStart, q.repeat.periodStart);
                showToast('Shipped! That\'s ' + q.completedCount + ' — plan reset for the next round.', 'green');
            } else {
                q.status = 'completed';
                q.completedAt = new Date().toISOString();
                q.completedCount = (q.completedCount || 0) + 1;
                showToast('Quest complete: ' + q.name, 'green');
            }
            applyBonusXP(q.bonusXP || 0);
            await saveUserData();
            updateDashboard();
            renderQuestsTab();
        };

        window.undoQuestCompletion = async function(questId) {
            var q = findQuestById(questId);
            if (!q) return;
            if (q.status === 'completed' && !q.repeat) {
                if (!confirm('Undo completion of "' + q.name + '"? The ' + (q.bonusXP || 0) + ' XP will be returned.')) return;
                q.status = 'active';
                q.completedAt = null;
                q.completedCount = Math.max(0, (q.completedCount || 1) - 1);
                applyBonusXP(-(q.bonusXP || 0));
            } else if (q.repeat && window._lastQuestCompletion && window._lastQuestCompletion.questId === questId) {
                // Repeating undo is session-scoped via the snapshot
                var snap = window._lastQuestCompletion;
                q.completedCount = Math.max(0, (q.completedCount || 1) - 1);
                q.repeat.periodStart = snap.periodStart;
                (q.tasks || []).forEach(function(t) {
                    var st = snap.taskState.find(function(x) { return x.id === t.id; });
                    if (!st) return;
                    t.done = st.done; t.doneAt = st.doneAt; t.doneVia = st.doneVia;
                    t.startDate = st.startDate; t.dueDate = st.dueDate;
                    (t.subtasks || []).forEach(function(s) {
                        var ss = (st.subDone || []).find(function(x) { return x.id === s.id; });
                        if (ss) s.done = ss.done;
                    });
                });
                window._lastQuestCompletion = null;
                applyBonusXP(-(q.bonusXP || 0));
            } else {
                return;
            }
            await saveUserData();
            updateDashboard();
            renderQuestsTab();
            showToast('Quest completion undone — XP returned', 'olive');
        };

        window.deleteQuest = async function(questId) {
            if (!confirm('Delete this quest? Its plan and shipped count are lost.')) return;
            var quests = getQuests();
            var idx = quests.findIndex(function(q) { return q.id === questId; });
            if (idx === -1) return;
            quests.splice(idx, 1);
            if (window._openQuestId === questId) window._openQuestId = null;
            await saveUserData();
            renderQuestsTab();
        };

        // ── Quest modal (create/edit — tasks live on the dashboard) ───────
        let _editingQuestId = null;

        window.openQuestModal = function(questId) {
            _editingQuestId = questId || null;
            var q = questId ? findQuestById(questId) : null;
            document.getElementById('questModalTitle').textContent = q ? 'Edit Quest' : 'New Quest';
            document.getElementById('questSubmitBtn').textContent = q ? 'Save Quest' : 'Create Quest';
            document.getElementById('questName').value = q ? q.name : '';
            document.getElementById('questDescription').value = (q && q.description) || '';
            document.getElementById('questDeadline').value = (q && q.deadline) || '';
            document.getElementById('questBonusXP').value = q ? (q.bonusXP || 100) : 100;
            var unitSel = document.getElementById('questRepeatUnit');
            var everyInp = document.getElementById('questRepeatEvery');
            unitSel.value = (q && q.repeat) ? q.repeat.unit : '';
            everyInp.value = (q && q.repeat) ? (q.repeat.every || 1) : 1;
            questRepeatUnitChanged();
            document.getElementById('questModal').classList.add('active');
        };
        window.closeQuestModal = function() {
            document.getElementById('questModal').classList.remove('active');
            _editingQuestId = null;
        };
        // Hide the "every N" number while repeat is off
        window.questRepeatUnitChanged = function() {
            var unit = document.getElementById('questRepeatUnit').value;
            var wrap = document.getElementById('questRepeatEveryWrap');
            if (wrap) wrap.style.display = unit ? 'flex' : 'none';
        };

        window.saveQuest = async function(event) {
            event.preventDefault();
            var name = document.getElementById('questName').value.trim();
            if (!name) return;
            var description = document.getElementById('questDescription').value.trim();
            var deadline = document.getElementById('questDeadline').value || null;
            var bonusXP = Math.min(500, Math.max(10, parseInt(document.getElementById('questBonusXP').value) || 100));
            var unit = document.getElementById('questRepeatUnit').value || null;
            var every = parseInt(document.getElementById('questRepeatEvery').value) || 1;
            if (unit) {
                var caps = { day: 365, week: 52, month: 24 };
                every = Math.min(caps[unit] || 52, Math.max(1, every));
            }
            if (_editingQuestId) {
                var q = findQuestById(_editingQuestId);
                if (!q) { closeQuestModal(); return; }
                q.name = name;
                q.description = description;
                q.deadline = deadline;
                q.bonusXP = bonusXP;
                if (unit) {
                    if (q.repeat) { q.repeat.unit = unit; q.repeat.every = every; }
                    else q.repeat = { every: every, unit: unit, periodStart: localToday() };
                } else {
                    q.repeat = null;
                }
                await saveUserData();
                closeQuestModal();
                renderQuestsTab();
            } else {
                var newId = 'q_' + Date.now().toString(36);
                getQuests().push({
                    id: newId,
                    name: name,
                    description: description,
                    deadline: deadline,
                    bonusXP: bonusXP,
                    status: 'active',
                    tasks: [],
                    repeat: unit ? { every: every, unit: unit, periodStart: localToday() } : null,
                    completedCount: 0,
                    createdAt: new Date().toISOString(),
                    completedAt: null
                });
                await saveUserData();
                closeQuestModal();
                // Land straight on the new quest's dashboard so the next
                // action — adding tasks — is right there.
                window._openQuestId = newId;
                renderQuestsTab();
            }
        };

        // ── Task editor sheet ─────────────────────────────────────────────
        let _editingTask = null;          // { questId, taskId|null }
        let _taskDraftSubtasks = [];
        let _taskDraftActivityId = null;

        window.openTaskEditor = function(questId, taskId) {
            var q = findQuestById(questId);
            if (!q) return;
            var t = taskId ? findQuestTask(q, taskId) : null;
            _editingTask = { questId: questId, taskId: taskId || null };
            _taskDraftSubtasks = t ? (t.subtasks || []).map(function(s) { return { id: s.id, title: s.title, done: s.done }; }) : [];
            _taskDraftActivityId = t ? (t.activityId || null) : null;
            document.getElementById('taskModalTitle').textContent = t ? 'Edit Task' : 'New Task';
            document.getElementById('taskSubmitBtn').textContent = t ? 'Save Task' : 'Add Task';
            document.getElementById('taskTitle').value = t ? (t.title || '') : '';
            document.getElementById('taskDescription').value = t ? (t.description || '') : '';
            document.getElementById('taskStartDate').value = (t && t.startDate) || '';
            document.getElementById('taskDueDate').value = (t && t.dueDate) || '';
            document.getElementById('taskXP').value = (t && t.xp) || '';
            document.getElementById('taskDeleteBtn').style.display = t ? '' : 'none';
            taskEditorRenderLink();
            taskEditorRenderSubs();
            document.getElementById('taskModal').classList.add('active');
        };
        window.closeTaskEditor = function() {
            document.getElementById('taskModal').classList.remove('active');
            _editingTask = null;
            _taskDraftSubtasks = [];
            _taskDraftActivityId = null;
        };

        function taskEditorRenderLink() {
            var row = document.getElementById('taskLinkRow');
            var xpField = document.getElementById('taskXPField');
            if (!row) return;
            if (_taskDraftActivityId) {
                var e = ttFindActivity(_taskDraftActivityId);
                row.innerHTML = '<div class="qd-linkrow">'
                    + '<span class="tt-prereq-dot" style="background:' + (e ? ttDimHexRaw(e.dim.id) : 'var(--color-progress)') + ';"></span>'
                    + '<span class="qd-linkname">' + escapeHtml(e ? e.activity.name : 'Unknown activity') + '</span>'
                    + '<button type="button" class="qd-unlink" onclick="taskEditorUnlink()" title="Unlink activity" aria-label="Unlink activity">' + ttIcon('x', 11) + '</button>'
                    + '</div>';
                // Linked tasks earn XP through the activity itself — no double award
                if (xpField) xpField.style.display = 'none';
            } else {
                row.innerHTML = '<button type="button" class="btn-secondary pl-btn-secondary" style="width:100%;" onclick="taskEditorLinkActivity()">'
                    + ttIcon('link', 11) + ' Link an activity</button>';
                if (xpField) xpField.style.display = '';
            }
        }
        window.taskEditorLinkActivity = function() {
            questOpenActivityPicker(function(activityId) {
                _taskDraftActivityId = activityId;
                taskEditorRenderLink();
            });
        };
        window.taskEditorUnlink = function() {
            _taskDraftActivityId = null;
            taskEditorRenderLink();
        };

        function taskEditorRenderSubs() {
            var el = document.getElementById('taskSubList');
            if (!el) return;
            el.innerHTML = _taskDraftSubtasks.map(function(s, i) {
                return '<div class="qd-draftsub">'
                    + '<input type="text" class="pl-input" value="' + escapeHtml(s.title) + '" onchange="taskDraftSetSub(' + i + ', this.value)">'
                    + '<button type="button" class="qd-unlink" onclick="taskDraftRemoveSub(' + i + ')" title="Remove subtask" aria-label="Remove subtask">' + ttIcon('x', 11) + '</button>'
                    + '</div>';
            }).join('');
        }
        window.taskDraftSetSub = function(i, v) { if (_taskDraftSubtasks[i]) _taskDraftSubtasks[i].title = v; };
        window.taskDraftRemoveSub = function(i) { _taskDraftSubtasks.splice(i, 1); taskEditorRenderSubs(); };
        window.taskDraftAddSub = function() {
            _taskDraftSubtasks.push({ id: 's_' + Date.now().toString(36) + '_' + _taskDraftSubtasks.length, title: '', done: false });
            taskEditorRenderSubs();
        };

        window.saveTask = async function(event) {
            event.preventDefault();
            if (!_editingTask) return;
            var q = findQuestById(_editingTask.questId);
            if (!q) { closeTaskEditor(); return; }
            var title = document.getElementById('taskTitle').value.trim();
            if (!title && !_taskDraftActivityId) return;
            var description = document.getElementById('taskDescription').value.trim();
            var startDate = document.getElementById('taskStartDate').value || null;
            var dueDate = document.getElementById('taskDueDate').value || null;
            if (startDate && dueDate && dueDate < startDate) { var tmp = startDate; startDate = dueDate; dueDate = tmp; }
            var xpRaw = parseInt(document.getElementById('taskXP').value);
            var xp = (!_taskDraftActivityId && xpRaw > 0) ? Math.min(100, xpRaw) : null;
            var subs = _taskDraftSubtasks.filter(function(s) { return s.title && s.title.trim(); })
                .map(function(s) { return { id: s.id, title: s.title.trim(), done: !!s.done }; });

            if (_editingTask.taskId) {
                var t = findQuestTask(q, _editingTask.taskId);
                if (!t) { closeTaskEditor(); return; }
                t.title = title;
                t.description = description;
                t.startDate = startDate;
                t.dueDate = dueDate;
                t.activityId = _taskDraftActivityId;
                t.xp = xp;
                t.subtasks = subs;
            } else {
                if (!Array.isArray(q.tasks)) q.tasks = [];
                q.tasks.push({
                    id: 't_' + Date.now().toString(36),
                    title: title, description: description,
                    activityId: _taskDraftActivityId, xp: xp,
                    startDate: startDate, dueDate: dueDate,
                    done: false, doneAt: null, doneVia: null,
                    subtasks: subs,
                    order: q.tasks.length
                });
            }
            await saveUserData();
            closeTaskEditor();
            renderQuestsTab();
        };

        window.deleteTask = async function() {
            if (!_editingTask || !_editingTask.taskId) return;
            var q = findQuestById(_editingTask.questId);
            var t = q && findQuestTask(q, _editingTask.taskId);
            if (!q || !t) { closeTaskEditor(); return; }
            // Bare tasks delete silently (routine action); tasks carrying
            // written content get one confirm — that content is gone forever.
            var hasContent = (t.subtasks || []).length > 0 || (t.description || '').trim();
            if (hasContent && !confirm('Delete this task and its subtasks?')) return;
            q.tasks = q.tasks.filter(function(x) { return x.id !== t.id; });
            await saveUserData();
            closeTaskEditor();
            renderQuestsTab();
        };

        // Thin activity picker — same overlay as the tech tree's, minus the
        // mastery-goal prompt detour. Shared by task linking and the
        // challenge-race "I already do this" mapping.
        function questOpenActivityPicker(onPick, title, subtitle) {
            window._questPickerOnPick = onPick;
            var rows = ttAllActivities().map(function(e) {
                return '<button class="tt-picker-row" onclick="questPickerSelect(\'' + e.activity.id + '\')">'
                    + '<span class="tt-prereq-dot" style="background:' + ttDimHexRaw(e.dim.id) + ';"></span>'
                    + '<span class="tt-picker-name">' + escapeHtml(e.activity.name) + '</span>'
                    + '<span class="tt-picker-meta">' + escapeHtml(e.activity.frequency || '') + '</span>'
                    + '</button>';
            }).join('') || '<p class="tt-muted">No activities yet — create some first.</p>';
            ttShowOverlay(
                '<div class="tt-form">'
                + '<h3 class="tt-form-title">' + escapeHtml(title || 'Link an activity') + '</h3>'
                + '<p class="tt-muted">' + escapeHtml(subtitle || 'Completing it will check this task automatically.') + '</p>'
                + '<div class="tt-picker-list">' + rows + '</div>'
                + '<div class="tt-form-actions"><button class="tt-btn tt-btn-ghost" onclick="ttCloseOverlay()">Cancel</button></div>'
                + '</div>'
            );
        }
        window.questPickerSelect = function(activityId) {
            var fn = window._questPickerOnPick;
            window._questPickerOnPick = null;
            ttCloseOverlay();
            if (fn) fn(activityId);
        };

        // Undone tasks whose date window covers today — consumed by the
        // Today view's pinned "Quest window" strip.
        function getActiveQuestWindowItems() {
            var today = localToday();
            var items = [];
            getQuests().forEach(function(q) {
                if (q.status !== 'active') return;
                (q.tasks || []).forEach(function(t) {
                    if (t.done) return;
                    var start = t.startDate || t.dueDate;
                    var end = t.dueDate || t.startDate;
                    if (start && start <= today && today <= end) {
                        items.push({ quest: q, task: t });
                    }
                });
            });
            return items;
        }

        // Challenge activity type handled by onChallengeTypeChange()

        // Render Challenges
        function renderChallenges() {
            const container = document.getElementById('challengesContainer');
            const challenges = window.userData.challenges || [];

            if (challenges.length === 0) {
                container.innerHTML = `
                    <div class="ch-empty">
                        <div class="ch-empty-icon">🏆</div>
                        <div class="ch-empty-text">No challenges yet. Tap <strong>+ Create Challenge</strong> above to set a time-boxed goal and earn bonus XP.</div>
                    </div>
                `;
                return;
            }

            const activeChallenges    = challenges.filter(c => c.status === 'active');
            const completedChallenges = challenges.filter(c => c.status === 'completed');
            const failedChallenges    = challenges.filter(c => c.status === 'failed');

            if (window._completedChallengesExpanded === undefined) window._completedChallengesExpanded = false;
            if (window._failedChallengesExpanded === undefined) window._failedChallengesExpanded = false;
            const completedOpen = window._completedChallengesExpanded;
            const failedOpen    = window._failedChallengesExpanded;

            const chevSvg = (open) => `<svg class="ch-section-chev${open ? ' expanded' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

            let html = '';

            // Active section — always expanded, no chevron
            if (activeChallenges.length > 0) {
                html += `
                <div class="ch-section-head">
                    <div class="ch-section-head-left">
                        <h3 class="ch-section-title">Active</h3>
                        <span class="ch-section-count">${activeChallenges.length}</span>
                    </div>
                </div>`;
                html += activeChallenges.map(c => renderChallengeCard(c, challenges.indexOf(c))).join('');
            }

            if (completedChallenges.length > 0) {
                html += `
                <div class="ch-section-head ch-collapsible" onclick="toggleCompletedChallenges()">
                    <div class="ch-section-head-left">
                        <h3 class="ch-section-title">Completed</h3>
                        <span class="ch-section-count ch-count-green">${completedChallenges.length}</span>
                    </div>
                    ${chevSvg(completedOpen)}
                </div>
                <div id="completedChallengesSection" style="display:${completedOpen ? 'block' : 'none'};">
                    ${completedChallenges.map(c => renderChallengeCard(c, challenges.indexOf(c))).join('')}
                </div>`;
            }

            if (failedChallenges.length > 0) {
                html += `
                <div class="ch-section-head ch-collapsible" onclick="toggleFailedChallenges()">
                    <div class="ch-section-head-left">
                        <h3 class="ch-section-title">Failed</h3>
                        <span class="ch-section-count ch-count-red">${failedChallenges.length}</span>
                    </div>
                    ${chevSvg(failedOpen)}
                </div>
                <div id="failedChallengesSection" style="display:${failedOpen ? 'block' : 'none'};">
                    ${failedChallenges.map(c => renderChallengeCard(c, challenges.indexOf(c))).join('')}
                </div>`;
            }

            container.innerHTML = html;
        }

        window.toggleCompletedChallenges = function() {
            window._completedChallengesExpanded = !window._completedChallengesExpanded;
            renderChallenges();
        };
        window.toggleFailedChallenges = function() {
            window._failedChallengesExpanded = !window._failedChallengesExpanded;
            renderChallenges();
        };

        // Info modal handlers
        window.openChallengesInfo = function() {
            const m = document.getElementById('challengesInfoModal');
            if (m) m.classList.add('active');
        };
        window.closeChallengesInfo = function() {
            const m = document.getElementById('challengesInfoModal');
            if (m) m.classList.remove('active');
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

            // ── Name map for activity ids → names ──────────────────────────
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

            // ── Activity progress aggregates (always computed, since this
            //    drives the breakdown panel and the per-activity bars) ─────
            let activityPct = 0;
            let totalCurrent = 0, totalTarget = 0;
            if (hasPerActivity) {
                totalTarget  = challengeActivityIds.reduce((s, id) => s + (challenge.activityTargets[id] || 1), 0);
                totalCurrent = challengeActivityIds.reduce((s, id) =>
                    s + Math.min((challenge.activityProgress || {})[id] || 0, challenge.activityTargets[id] || 1), 0);
                activityPct = totalTarget > 0 ? Math.min(100, (totalCurrent / totalTarget) * 100) : 0;
            }
            const allTargetsMet = isActive && hasPerActivity && activityPct >= 100;

            // ── Card state ────────────────────────────────────────────────
            const cardState = isCompleted ? 'completed'
                : isFailed ? 'failed'
                : allTargetsMet ? 'targets'
                : 'active';

            // ── Progress hero band (count + bar + pct) ────────────────────
            //   Metric mode:           "12 / 30 DAYS" + bar + "%"
            //   Activity-only mode:    "9 / 20" + bar + "%"
            //   Any-activity mode:     "N completions" + bar (always 0/100 ish)
            let countHtml = '';
            let mainPct = 0;
            const fmtNum = (v) => Number.isInteger(v) ? String(v) : (Math.round(v * 100) / 100).toString();

            if (hasMetric) {
                const metricCurrent = +(challenge.metricCurrent || 0);
                const metricPct = Math.min(100, (metricCurrent / challenge.metricQty) * 100);
                mainPct = metricPct;
                countHtml = `
                    <span class="ch-count">
                        <span class="ch-count-current">${fmtNum(metricCurrent)}</span>
                        <span class="ch-count-sep">/</span>
                        <span class="ch-count-target">${fmtNum(+challenge.metricQty)}</span>
                    </span>
                    <span class="ch-count-unit">${escapeHtml(challenge.metricUnit || '')}</span>`;
            } else if (hasPerActivity) {
                mainPct = activityPct;
                countHtml = `
                    <span class="ch-count">
                        <span class="ch-count-current">${totalCurrent}</span>
                        <span class="ch-count-sep">/</span>
                        <span class="ch-count-target">${totalTarget}</span>
                    </span>`;
            } else {
                // Legacy any-activity mode
                const anyCount = challenge.currentCount || 0;
                mainPct = isCompleted ? 100 : 0;
                countHtml = `
                    <span class="ch-count">
                        <span class="ch-count-current">${anyCount}</span>
                    </span>
                    <span class="ch-count-unit">${anyCount === 1 ? 'completion' : 'completions'}</span>`;
            }

            const progressHtml = `
                <div class="ch-progress">
                    <div class="ch-progress-top">
                        <div style="display:inline-flex;align-items:baseline;gap:4px;min-width:0;">
                            ${countHtml}
                        </div>
                        <span class="ch-pct">${Math.floor(mainPct)}%</span>
                    </div>
                    <div class="ch-bar"><div class="ch-bar-inner" style="width:${mainPct}%;"></div></div>
                </div>`;

            // ── Complete / Take-again button ──────────────────────────────
            const enforced = !!(challenge.enforceActivities) && hasPerActivity;
            const completeBlocked = enforced && !allTargetsMet;
            const checkSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
            const refreshSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg>`;

            let primaryBtn = '';
            if (isActive) {
                const readyClass = allTargetsMet ? ' ch-complete-ready' : '';
                primaryBtn = `
                    <button class="ch-complete${readyClass}" onclick="completeChallenge(${index})"
                            ${completeBlocked ? 'disabled title="Complete all activity targets first"' : ''}>
                        ${checkSvg}<span>${allTargetsMet ? 'Claim bonus' : 'Complete'}</span>
                    </button>`;
            } else if (isCompleted) {
                primaryBtn = `
                    <button class="ch-take-again" onclick="takeAgainChallenge(${index})">
                        ${refreshSvg}<span>Take Again</span>
                    </button>`;
            } else if (isFailed) {
                primaryBtn = `
                    <button class="ch-take-again" onclick="takeAgainChallenge(${index})">
                        ${refreshSvg}<span>Retry</span>
                    </button>`;
            }

            // ── Breakdown chevron (minimal, ghost-button style) ───────────
            //   Shown when there's something to reveal: per-activity rows,
            //   OR an active metric challenge (so the input can live inside).
            const showBreakdown = hasPerActivity || (isActive && hasMetric);
            const breakdownCollapsed = challenge.activityProgressCollapsed !== false;
            let breakdownBtnHtml = '';
            let breakdownBodyHtml = '';

            if (showBreakdown) {
                breakdownBtnHtml = `
                    <button class="ch-breakdown-btn" onclick="toggleChallengeBreakdown('${challenge.id}')" type="button">
                        <span>Details</span>
                        <svg id="ch-breakdown-icon-${challenge.id}" class="ch-breakdown-chev${breakdownCollapsed ? '' : ' expanded'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>`;

                // Metric update row (inside the breakdown now)
                let metricUpdateHtml = '';
                if (isActive && hasMetric) {
                    const cur = challenge.metricCurrent || 0;
                    metricUpdateHtml = `
                        <div class="ch-metric-update-wrap">
                            <div class="ch-metric-update-label">Update progress · ${escapeHtml(challenge.metricUnit || '')}</div>
                            <div class="ch-metric-update-row">
                                <input class="ch-metric-input" type="number" inputmode="decimal" id="metric-input-${challenge.id}"
                                       placeholder="${escapeHtml(challenge.metricUnit || '0')}" step="any" min="0" max="${challenge.metricQty}"
                                       value="${cur > 0 ? cur : ''}">
                                <button type="button" class="ch-metric-update-btn" onclick="updateMetricProgress('${challenge.id}')">Update</button>
                            </div>
                        </div>`;
                }

                // Per-activity rows
                let activityRowsHtml = '';
                if (hasPerActivity) {
                    activityRowsHtml = challengeActivityIds.map(id => {
                        const target  = challenge.activityTargets[id] || 1;
                        const current = Math.min((challenge.activityProgress || {})[id] || 0, target);
                        const pct     = Math.min(100, (current / target) * 100);
                        const done    = current >= target;
                        return `
                        <div class="ch-act-row-v2">
                            <div class="ch-act-row-top">
                                <span class="ch-act-row-name-v2${done ? ' done' : ''}">${escapeHtml(nameMap[id]||id)}</span>
                                <span class="ch-act-row-count-v2">${current}/${target}</span>
                            </div>
                            <div class="ch-act-bar-v2"><div class="ch-act-bar-v2-fill${done ? ' done' : ''}" style="width:${pct}%;"></div></div>
                        </div>`;
                    }).join('');
                }

                breakdownBodyHtml = `
                    <div class="ch-breakdown-body${breakdownCollapsed ? '' : ' expanded'}" id="ch-breakdown-${challenge.id}"
                         style="max-height:${breakdownCollapsed ? '0' : '900px'};">
                        ${metricUpdateHtml}
                        ${activityRowsHtml}
                    </div>`;
            }

            // ── Subtitle / enforced chip / meta ─────────────────────────────
            // Enforced moves next to the description (the subtitle row) when
            // one exists. When there's no description we keep it in the meta
            // line as a fallback so the badge isn't lost.
            const hasDescription = !!challenge.description;
            const enforcedChipHtml = enforced ? `<span class="ch-enforced-chip" title="All targets must be met to claim the bonus">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                Enforced
            </span>` : '';

            const metaParts = [];
            metaParts.push(`<span class="ch-meta-xp">+${challenge.bonusXP} XP</span>`);
            // Friend-race badge — blue counter chip with opponent progress
            if (challenge.race && challenge.race.inviteId) {
                const opp = challenge.race.lastOpponent;
                const oppProgress = opp ? ` · ${opp.currentCount || 0}/${opp.targetCount || challenge.targetCount || 0}` : '';
                metaParts.push(`<span class="ch-meta-sep">·</span>`);
                metaParts.push(`<span class="race-vs-chip" title="Racing ${escapeHtml(challenge.race.withName || 'a friend')} — first to finish wins">vs ${escapeHtml(challenge.race.withName || 'friend')}${oppProgress}</span>`);
            }
            if (isActive) {
                metaParts.push(`<span class="ch-meta-sep">·</span>`);
                metaParts.push(`<span>${daysLeft > 0 ? daysLeft + ' days left' : (daysLeft === 0 ? 'Ends today' : 'Ended ' + Math.abs(daysLeft) + 'd ago')}</span>`);
            }
            if (challengeActivityIds.length > 0) {
                metaParts.push(`<span class="ch-meta-sep">·</span>`);
                metaParts.push(`<span>${challengeActivityIds.length} ${challengeActivityIds.length === 1 ? 'activity' : 'activities'}</span>`);
            }
            // Fallback: only show enforced inside the meta line when there's
            // no description to attach it to (otherwise it sits in the subtitle row).
            if (enforced && !hasDescription) {
                metaParts.push(`<span class="ch-meta-sep">·</span>`);
                metaParts.push(enforcedChipHtml);
            }
            const metaHtml = metaParts.join('');

            // ── SVG icons for the top-right action buttons ────────────────
            const editSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
            const trashSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;

            return `
                <div class="ch-card" data-state="${cardState}">
                    <div class="ch-card-head">
                        <div class="ch-card-titlecol">
                            <h3 class="ch-card-title">${escapeHtml(challenge.name)}</h3>
                            ${hasDescription ? `
                            <div class="ch-subtitle-row">
                                <p class="ch-card-desc">${escapeHtml(challenge.description)}</p>
                                ${enforcedChipHtml}
                            </div>
                            <div class="ch-divider" aria-hidden="true"></div>
                            ` : ''}
                            <div class="ch-meta">${metaHtml}</div>
                        </div>
                        <div class="ch-card-actions">
                            ${isActive ? `<button class="ch-icon-btn" onclick="editChallenge(${index})" title="Edit challenge" aria-label="Edit challenge">${editSvg}</button>` : ''}
                            <button class="ch-icon-btn ch-icon-danger" onclick="deleteChallenge(${index})" title="Delete challenge" aria-label="Delete challenge">${trashSvg}</button>
                        </div>
                    </div>

                    ${progressHtml}

                    <div class="ch-action-row">
                        ${primaryBtn}
                        ${isActive && !(challenge.race && challenge.race.inviteId) ? `
                        <button class="ch-breakdown-btn race-invite-btn" type="button" onclick="openChallengeFriendPicker(${index})" title="Race a friend — first to finish wins">
                            <span>Challenge a friend</span>
                        </button>` : ''}
                        ${breakdownBtnHtml}
                    </div>
                    ${breakdownBodyHtml}
                </div>`;
        }

        // New toggle handler name — paired with the new markup. The old
        // toggleActivityProgress is kept as an alias for any in-flight cached
        // markup, but new cards call toggleChallengeBreakdown.
        window.toggleChallengeBreakdown = function(challengeId) {
            const body = document.getElementById('ch-breakdown-' + challengeId);
            const icon = document.getElementById('ch-breakdown-icon-' + challengeId);
            if (!body) return;
            const wasExpanded = body.classList.contains('expanded');
            if (wasExpanded) {
                body.classList.remove('expanded');
                body.style.maxHeight = '0';
                if (icon) icon.classList.remove('expanded');
            } else {
                body.classList.add('expanded');
                body.style.maxHeight = (body.scrollHeight + 40) + 'px';
                if (icon) icon.classList.add('expanded');
            }
            // Persist collapsed-state so it survives a re-render
            const challenges = window.userData.challenges || [];
            const ch = challenges.find(c => c.id === challengeId);
            if (ch) {
                ch.activityProgressCollapsed = wasExpanded;  // collapsed if it was expanded before this tap
                saveUserData();
            }
        };


                function renderCategoriesActivities(activities, dimIndex, pathIndex, dimHex) {
            if (activities.length === 0) {
                return '<div class="cat-empty">No activities yet · use <strong>+ Activity</strong> above</div>';
            }

            const freqLabel = { daily:'Daily', occasional:'Occasional', weekly:'Weekly', biweekly:'Bi-weekly', monthly:'Monthly', custom:'Custom', 'one-time':'Occasional' };
            const kebabSvg = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>`;
            const checkSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;"><polyline points="20 6 9 17 4 12"/></svg>`;
            const undoSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>`;

            return activities.map((activity, actIndex) => {
                const completedToday = isCompletedToday(activity);
                const canComplete = canCompleteActivity(activity);
                const allowMulti = activity.allowMultiplePerDay && activity.frequency !== 'occasional';
                const permDone = activity.frequency === 'one-time' && completedToday;

                let clickHandler, cardClass;
                if (permDone) {
                    clickHandler = 'void(0)';
                    cardClass = 'cat-act-permdone';
                } else if (allowMulti) {
                    clickHandler = `completeActivity(${dimIndex}, ${pathIndex}, ${actIndex})`;
                    cardClass = completedToday ? 'cat-act-done-multi' : '';
                } else if (completedToday) {
                    clickHandler = 'void(0)';
                    cardClass = 'cat-act-done';
                } else if (canComplete) {
                    clickHandler = `completeActivity(${dimIndex}, ${pathIndex}, ${actIndex})`;
                    cardClass = '';
                } else {
                    clickHandler = 'void(0)';
                    cardClass = 'cat-act-disabled';
                }

                const freqText = freqLabel[activity.frequency] || activity.frequency;
                const customNote = activity.frequency === 'custom' && activity.customDays ? ` (${activity.customDays}d)` : '';
                const showUndo = countCompletionsToday(activity) > 0;

                // Multi-complete counter — only on cards that allow multiple/day
                let multiCount = '';
                if (allowMulti) {
                    const n = countCompletionsToday(activity);
                    if (n > 0) multiCount = `<span class="cat-act-multi">×${n}</span>`;
                }

                // Custom cycle progress chip — only when timesPerCycle > 1
                let cycleChip = '';
                if (activity.frequency === 'custom' && (activity.timesPerCycle || 1) > 1) {
                    const doneInCycle = cycleCompletionsNow(activity);
                    const needed = activity.timesPerCycle || 1;
                    cycleChip = `<span class="activity-badge badge-counter">${doneInCycle}/${needed}</span>`;
                }

                // Stable selector for search "Go to" — find by activity id.
                const actId = activity.id || '';

                const undoBtn = showUndo
                    ? `<button class="cat-act-undo" onclick="event.stopPropagation();undoActivity(${dimIndex}, ${pathIndex}, ${actIndex})" title="Undo">${undoSvg}</button>`
                    : '';

                return `
                <div class="cat-act-card ${cardClass}" data-act-id="${escapeHtml(actId)}" onclick="${clickHandler}">
                    <div class="cat-act-textcol">
                        <div class="cat-act-name">${escapeHtml(activity.name)}</div>
                        ${activity.description ? `<div class="cat-act-desc">${escapeHtml(activity.description)}</div>` : ''}
                        <div class="cat-act-meta">
                            <span class="activity-badge badge-frequency">${freqText}${customNote}</span>
                            <span class="activity-badge ${activity.isNegative ? 'badge-negative' : 'badge-xp'}">${activity.isNegative ? '−' : '+'}${activity.baseXP} XP</span>
                            ${activity.streak > 0 ? `<span class="activity-badge badge-streak">🔥 ${activity.streak}</span>` : ''}
                            ${cycleChip}
                            ${multiCount}
                        </div>
                    </div>
                    <div class="cat-act-actions" onclick="event.stopPropagation()">
                        ${undoBtn}
                        <div class="cat-act-check">${checkSvg}</div>
                        <button class="cat-kebab" onclick="openCatActionMenu('act',${dimIndex},${pathIndex},${actIndex})" aria-label="More options">${kebabSvg}</button>
                    </div>
                </div>`;
            }).join('');
        }

        // Legacy alias — some older code paths may still call renderActivities;
        // route them through the new categories renderer with a neutral dim color.
        function renderActivities(activities, dimIndex, pathIndex) {
            return renderCategoriesActivities(activities, dimIndex, pathIndex, '#5a9fd4');
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
                renderDimensionColorPills(dim.color || 'blue');
            } else {
                title.textContent = 'Create Dimension';
                document.getElementById('dimensionForm').reset();
                renderDimensionColorPills('blue');
            }

            modal.classList.add('active');
        };

        function renderDimensionColorPills(selected) {
            var row = document.getElementById('dimensionColorPills');
            var hiddenInput = document.getElementById('dimensionColor');
            if (!row || !hiddenInput) return;
            hiddenInput.value = selected || 'blue';
            row.innerHTML = DIM_COLOR_ORDER.map(function(c) {
                var hex = DIM_HEX_MAP[c];
                var sel = (c === hiddenInput.value) ? ' selected' : '';
                return '<button type="button" class="dim-color-pill' + sel + '"'
                    + ' data-color="' + c + '"'
                    + ' style="background:' + hex + ';"'
                    + ' aria-label="' + c + '"'
                    + ' onclick="selectDimensionColor(\'' + c + '\')"></button>';
            }).join('');
        }

        window.selectDimensionColor = function(color) {
            renderDimensionColorPills(color);
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
                getActivityIdsInDimension(dim).forEach(id => { cleanupQuestsForActivity(id); cleanupChallengesForActivity(id); });
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
                (path.activities || []).forEach(act => { cleanupQuestsForActivity(act.id); cleanupChallengesForActivity(act.id); });
                window.userData.dimensions[dimIndex].paths.splice(pathIndex, 1);
                await saveUserData();
                updateDashboard();
            }
        };

        // ─────────────────────────────────────────────────────────────────
        // Categories Info Modal — explains the Dimension → Path → Activity
        // hierarchy. Brief §1 "Trust through transparency" — surface meaning
        // when asked, never force it.
        // ─────────────────────────────────────────────────────────────────
        window.openCategoriesInfo = function() {
            const m = document.getElementById('categoriesInfoModal');
            if (m) m.classList.add('active');
            try { window.trackEvent && window.trackEvent('cat_info_opened'); } catch(e){}
        };
        window.closeCategoriesInfo = function() {
            const m = document.getElementById('categoriesInfoModal');
            if (m) m.classList.remove('active');
        };

        // ─────────────────────────────────────────────────────────────────
        // Categories Search Overlay — "Go to" navigation, not Do/Undo.
        // Reuses the search-overlay/search-box/search-result-item primitives
        // from My Activities so visual language stays consistent. The action
        // column swaps in a single "Go to" button.
        // ─────────────────────────────────────────────────────────────────
        window.openCategoriesSearch = function() {
            const ov = document.getElementById('categoriesSearchOverlay');
            const input = document.getElementById('categoriesSearchInput');
            if (!ov || !input) return;
            ov.style.display = 'flex';
            input.value = '';
            renderCategoriesSearchResults();
            setTimeout(() => input.focus(), 60);
        };
        window.closeCategoriesSearch = function(e) {
            const ov = document.getElementById('categoriesSearchOverlay');
            if (!ov) return;
            // If invoked from overlay click, only close when click landed on the backdrop.
            if (e && e.target !== ov) return;
            ov.style.display = 'none';
        };
        window.categoriesSearchKeyHandler = function(e) {
            if (e.key === 'Escape') {
                const ov = document.getElementById('categoriesSearchOverlay');
                if (ov) ov.style.display = 'none';
            }
        };
        window.renderCategoriesSearchResults = function() {
            const query = (document.getElementById('categoriesSearchInput').value || '').trim().toLowerCase();
            const results = document.getElementById('categoriesSearchResults');
            if (!results) return;

            // Flatten all activities, skipping uncategorized so search results
            // always have a real dim+path to scroll to.
            let allActivities = [];
            (window.userData.dimensions || []).forEach((dim, di) => {
                if (dim.id === 'uncategorized') return;
                (dim.paths || []).forEach((path, pi) =>
                    (path.activities || []).forEach((act, ai) =>
                        allActivities.push({
                            ...act, _di: di, _pi: pi, _ai: ai,
                            _dimName: dim.name, _pathName: path.name,
                            _dimColor: dim.color
                        })));
            });

            const filtered = query
                ? allActivities.filter(a =>
                    a.name.toLowerCase().includes(query) ||
                    (a._dimName || '').toLowerCase().includes(query) ||
                    (a._pathName || '').toLowerCase().includes(query))
                : allActivities;

            if (filtered.length === 0) {
                results.innerHTML = `<div class="search-empty">${query ? 'No activities match "' + escapeHtml(query) + '"' : 'No activities yet — create one with <strong>+ Add Dimension</strong>'}</div>`;
                return;
            }

            const freqLabel = { daily:'Daily', occasional:'Occasional', weekly:'Weekly',
                biweekly:'Bi-weekly', monthly:'Monthly', custom:'Custom' };

            results.innerHTML = filtered.map(act => {
                const done = isCompletedToday(act);
                const statusIcon = done
                    ? `<span class="search-result-status" aria-label="Completed today"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>`
                    : '';
                const streakChip = act.streak > 0
                    ? `<span class="search-result-streak"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>${act.streak}</span>`
                    : '';

                const gotoBtn = `<button class="cat-search-goto" onclick="categoriesGoToActivity(${act._di},${act._pi},${act._ai})" title="Jump to this activity">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                    Go to
                </button>`;

                return `<div class="search-result-item${done ? ' completed' : ''}">
                    <div class="search-result-content">
                        <div class="search-result-name">${statusIcon}<span class="search-result-name-text">${escapeHtml(act.name)}</span></div>
                        <div class="search-result-stats">
                            <span class="search-result-xp">+${act.baseXP} XP</span>
                            ${streakChip}
                        </div>
                        <div class="search-result-meta">
                            <span class="search-result-freq">${freqLabel[act.frequency]||act.frequency}</span>
                            <span class="search-result-dot">·</span>
                            <span class="search-result-path">${escapeHtml(act._dimName)} › ${escapeHtml(act._pathName)}</span>
                        </div>
                    </div>
                    <div class="search-result-actions">${gotoBtn}</div>
                </div>`;
            }).join('');
        };

        // categoriesGoToActivity: closes search → ensures the right sub-tab is
        // open → expands dim+path → re-renders → scrolls the card into view →
        // applies a 2.5s glow halo. The render step is async (saveUserData)
        // so we wait for it before measuring positions.
        window.categoriesGoToActivity = async function(dimIndex, pathIndex, actIndex) {
            try {
                const dim = window.userData.dimensions[dimIndex];
                if (!dim) return;
                const path = (dim.paths || [])[pathIndex];
                if (!path) return;
                const act = (path.activities || [])[actIndex];
                if (!act) return;

                // 1. Close the search overlay.
                const ov = document.getElementById('categoriesSearchOverlay');
                if (ov) ov.style.display = 'none';

                // 2. Make sure the Categories sub-tab is the active one.
                //    (Search is only reachable from this tab, but guard anyway.)
                if (window.switchSubTab) {
                    try { window.switchSubTab('activities', 'categories'); } catch(e) {}
                }

                // 3. Expand the dim + path; persist so a refresh keeps the state.
                dim.expanded = true;
                path.expanded = true;
                try { await saveUserData(); } catch(e) { /* offline ok */ }

                // 4. Re-render (writes the new expanded markup to the DOM).
                renderDimensions();

                // 5. Find the activity card and scroll + glow. Defer one frame
                //    so layout has settled after the render.
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        const targetId = act.id || '';
                        if (!targetId) return;
                        const safe = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(targetId) : targetId;
                        const card = document.querySelector('.cat-act-card[data-act-id="' + safe + '"]');
                        if (!card) return;
                        // Smooth scroll, accounting for the sticky bottom nav.
                        try {
                            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        } catch(e) {
                            card.scrollIntoView();
                        }
                        // Clear any prior glow then apply afresh so re-jumps re-trigger.
                        card.classList.remove('cat-act-glow');
                        // Force reflow before re-adding the class.
                        void card.offsetWidth;
                        card.classList.add('cat-act-glow');
                        setTimeout(() => card.classList.remove('cat-act-glow'), 2600);
                    }, 60);
                });

                try { window.trackEvent && window.trackEvent('cat_search_goto'); } catch(e){}
            } catch (e) {
                console.warn('[categoriesGoToActivity] failed', e);
            }
        };

        // ─────────────────────────────────────────────────────────────────
        // Bottom-sheet action menu — replaces visible Edit/Delete buttons.
        // Brief §3 "Demote rather than remove". Reuses the gc-action-menu
        // shell so we don't invent a new modal primitive.
        // ─────────────────────────────────────────────────────────────────
        window.openCatActionMenu = function(kind, dimIndex, pathIndex, actIndex) {
            let el = document.getElementById('catActionMenu');
            if (!el) {
                el = document.createElement('div');
                el.id = 'catActionMenu';
                el.className = 'gc-action-menu';
                el.onclick = function(e) { if (e.target === el) closeCatActionMenu(); };
                document.body.appendChild(el);
            }

            // Build items per kind. Items are: View history (act only), Edit, Delete.
            let title = '';
            let items = [];

            if (kind === 'dim') {
                const dim = window.userData.dimensions[dimIndex];
                title = dim ? dim.name : 'Dimension';
                items = [
                    { icon: editIconSvg(), label: 'Edit dimension',
                      onClick: () => { closeCatActionMenu(); setTimeout(() => editDimension(dimIndex), 60); } },
                    { icon: pathIconSvg(), label: 'Add path',
                      onClick: () => { closeCatActionMenu(); setTimeout(() => openPathModal(dimIndex), 60); } },
                    { icon: trashIconSvg(), label: 'Delete dimension', danger: true,
                      onClick: () => { closeCatActionMenu(); setTimeout(() => deleteDimension(dimIndex), 60); } },
                ];
            } else if (kind === 'path') {
                const path = window.userData.dimensions[dimIndex].paths[pathIndex];
                title = path ? path.name : 'Path';
                items = [
                    { icon: editIconSvg(), label: 'Edit path',
                      onClick: () => { closeCatActionMenu(); setTimeout(() => editPath(dimIndex, pathIndex), 60); } },
                    { icon: actIconSvg(), label: 'Add activity',
                      onClick: () => { closeCatActionMenu(); setTimeout(() => openActivityModal(dimIndex, pathIndex), 60); } },
                    { icon: trashIconSvg(), label: 'Delete path', danger: true,
                      onClick: () => { closeCatActionMenu(); setTimeout(() => deletePath(dimIndex, pathIndex), 60); } },
                ];
            } else if (kind === 'act') {
                const act = window.userData.dimensions[dimIndex].paths[pathIndex].activities[actIndex];
                title = act ? act.name : 'Activity';
                items = [
                    { icon: editIconSvg(), label: 'Edit activity',
                      onClick: () => { closeCatActionMenu(); setTimeout(() => editActivity(dimIndex, pathIndex, actIndex), 60); } },
                ];
                // History — only if the function exists and the activity has any data
                if (typeof window.openActivityHistoryModal === 'function') {
                    items.push({ icon: historyIconSvg(), label: 'View history',
                        onClick: () => { closeCatActionMenu(); setTimeout(() => window.openActivityHistoryModal(dimIndex, pathIndex, actIndex), 60); } });
                }
                items.push({ icon: trashIconSvg(), label: 'Delete activity', danger: true,
                    onClick: () => { closeCatActionMenu(); setTimeout(() => deleteActivity(dimIndex, pathIndex, actIndex), 60); } });
            }

            // Build innerHTML, then attach handlers (avoids inline onclick string escaping).
            const titleHtml = title ? `<div class="cat-action-title">${escapeHtml(title)}</div>` : '';
            el.innerHTML =
                '<div class="gc-action-menu-inner">'
                + titleHtml
                + items.map((it, i) => {
                    const dangerClass = it.danger ? ' cat-action-danger' : '';
                    return `<button class="gc-action-item${dangerClass}" data-i="${i}">
                        <span class="gc-action-icon">${it.icon}</span><span>${escapeHtml(it.label)}</span>
                    </button>`;
                  }).join('')
                + '<button class="gc-action-item gc-action-cancel" data-i="cancel">Cancel</button>'
                + '</div>';

            el.querySelector('.gc-action-menu-inner').addEventListener('click', function(e) { e.stopPropagation(); });
            el.querySelectorAll('.gc-action-item').forEach(btn => {
                btn.addEventListener('click', function(ev) {
                    ev.stopPropagation();
                    const i = btn.getAttribute('data-i');
                    if (i === 'cancel') { closeCatActionMenu(); return; }
                    const item = items[parseInt(i, 10)];
                    if (item && typeof item.onClick === 'function') item.onClick();
                });
            });
            el.style.display = 'flex';
        };
        window.closeCatActionMenu = function() {
            const el = document.getElementById('catActionMenu');
            if (el) el.style.display = 'none';
        };

        // Tiny inline SVG helpers — keep the action menu visually consistent.
        function editIconSvg() {
            return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
        }
        function trashIconSvg() {
            return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;
        }
        function pathIconSvg() {
            return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h6m6 0h6"/><circle cx="12" cy="12" r="3"/></svg>`;
        }
        function actIconSvg() {
            return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        }
        function historyIconSvg() {
            return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
        }


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

        // ──────────────────────────────────────────────────────────────────
        // getOrCreateUncategorizedPath(dimIndex)
        // Ensures the given REAL dimension has an Uncategorized path. Returns
        // the path index. Used by Edit-Activity when the user keeps a real
        // dimension but wants the path to be Uncategorized — instead of
        // dumping the activity to the top-level uncategorized dim, we keep
        // it under the chosen dim with a per-dim "Uncategorized" path.
        // ──────────────────────────────────────────────────────────────────
        function getOrCreateUncategorizedPath(dimIndex) {
            const dim = window.userData.dimensions[dimIndex];
            if (!dim) return -1;
            if (!dim.paths) dim.paths = [];
            // Use a stable id pattern: 'uncategorized-path-<dimId>'. This avoids
            // collision with the top-level uncategorized dim's path id.
            const stableId = 'uncategorized-path-' + dim.id;
            let pi = dim.paths.findIndex(p => p.id === stableId);
            if (pi === -1) {
                dim.paths.push({
                    id: stableId,
                    name: 'Uncategorized',
                    expanded: true,
                    activities: [],
                    isUncategorized: true,
                    createdAt: new Date().toISOString()
                });
                pi = dim.paths.length - 1;
            }
            return pi;
        }

        // ── Populate path dropdown ────────────────────────────────────
        // For the top-level Uncategorized dim, only "Uncategorized" is offered.
        // For real dimensions, the dim's named paths are listed, plus an
        // "Uncategorized" sentinel at the end. Picking the sentinel routes the
        // activity to a per-dim Uncategorized path (created on save via
        // getOrCreateUncategorizedPath). The sentinel value is the literal
        // string 'uncategorized' so the existing save resolver still works.
        window.populateActivityPathSelect = function() {
            const dimId = document.getElementById('activityDimSelect').value;
            const pathSel = document.getElementById('activityPathSelect');
            if (!dimId || dimId === 'uncategorized') {
                pathSel.innerHTML = '<option value="uncategorized">Uncategorized</option>';
                return;
            }
            const dim = (window.userData.dimensions || []).find(d => d.id === dimId);
            const paths = dim ? (dim.paths || []).filter(p => !p.isUncategorized && p.id !== 'uncategorized') : [];
            const namedHtml = paths.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
            // Always offer Uncategorized as a fallback path under a real dim
            const uncOpt = '<option value="uncategorized">— Uncategorized —</option>';
            pathSel.innerHTML = namedHtml + uncOpt;
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
                syncActivityXPPreset();
                document.getElementById('activityFrequency').value = activity.frequency;

                // Set dim/path dropdowns to current assignment. A per-dim
                // "Uncategorized" path (id starts with 'uncategorized-path-')
                // is also surfaced as the literal 'uncategorized' sentinel in
                // the dropdown — the saveActivity resolver will re-create or
                // resolve it on save.
                const curDimId = dims[dimIndex].id;
                dimSel.value = curDimId || 'uncategorized';
                populateActivityPathSelect();
                const curPathObj = dims[dimIndex].paths[pathIndex];
                const curPathId  = curPathObj.id;
                const isUncatPath = (curPathId === 'uncategorized') || curPathObj.isUncategorized;
                document.getElementById('activityPathSelect').value =
                    isUncatPath ? 'uncategorized' : (curPathId || 'uncategorized');

                const isNegEnabled = !!(activity.isNegative || activity.isSkipNegative);
                document.getElementById('activityNegativeEnabled').checked = isNegEnabled;
                document.getElementById('negativeXpSection').style.display = isNegEnabled ? 'flex' : 'none';
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
                    (curPathId && curPathId !== 'uncategorized' && !curPathObj.isUncategorized) ||
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
                syncActivityXPPreset();

                // Pre-select dim/path if provided, else default to uncategorized
                if (dimIndex !== null && pathIndex !== null && dims[dimIndex]) {
                    dimSel.value = dims[dimIndex].id || 'uncategorized';
                } else {
                    dimSel.value = 'uncategorized';
                }
                populateActivityPathSelect();
                if (dimIndex !== null && pathIndex !== null && dims[dimIndex] && dims[dimIndex].paths[pathIndex]) {
                    const p = dims[dimIndex].paths[pathIndex];
                    const isUncat = (p.id === 'uncategorized') || p.isUncategorized;
                    document.getElementById('activityPathSelect').value =
                        isUncat ? 'uncategorized' : (p.id || 'uncategorized');
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

        // ── Advanced Setup accordion — v120 ────────────────────────────
        // The accordion is in-flow: when open, its body expands below the
        // header and pushes the modal-body height naturally. Both the
        // wrapper `.ay-accordion` and the body `.ay-accordion-body` carry
        // a `data-open` attribute for styling; the body's `display` is
        // also flipped (the CSS uses display:flex when data-open=true).
        function setAdvancedSectionOpen(open) {
            const content = document.getElementById('advancedSectionContent');
            const header  = document.getElementById('advancedSectionHeader');
            if (!content || !header) return;
            const wrapper = header.closest('.ay-accordion');
            const openStr = open ? 'true' : 'false';
            content.setAttribute('data-open', openStr);
            content.style.display = open ? 'flex' : 'none';
            if (wrapper) wrapper.setAttribute('data-open', openStr);
            header.setAttribute('aria-expanded', openStr);
        }
        window.toggleAdvancedSection = function() {
            const content = document.getElementById('advancedSectionContent');
            if (!content) return;
            const isOpen = content.getAttribute('data-open') === 'true' || content.style.display !== 'none';
            setAdvancedSectionOpen(!isOpen);
        };

        // ── XP preset chip handling ───────────────────────────────────
        // setActivityXP: clicked from one of the 3 preset chips. Writes the
        //   numeric value into the custom input AND highlights the chip.
        // syncActivityXPPreset: called when the custom input changes (or
        //   when the modal opens with an existing value). If the value
        //   matches one of the 3 presets exactly, that chip is highlighted;
        //   otherwise all chips are cleared (custom-only state).
        window.setActivityXP = function(value) {
            const input = document.getElementById('activityXP');
            if (input) input.value = value;
            syncActivityXPPreset();
        };
        window.syncActivityXPPreset = function() {
            const input = document.getElementById('activityXP');
            const row   = document.getElementById('ayXpPresets');
            if (!input || !row) return;
            const v = parseInt(input.value, 10);
            row.querySelectorAll('.ay-xp-chip').forEach(btn => {
                const xp = parseInt(btn.getAttribute('data-xp'), 10);
                btn.classList.toggle('active', xp === v);
            });
        };

        // ── Activity Info modal ────────────────────────────────────────
        window.openActivityInfo = function() {
            const m = document.getElementById('activityInfoModal');
            if (m) m.classList.add('active');
        };
        window.closeActivityInfo = function() {
            const m = document.getElementById('activityInfoModal');
            if (m) m.classList.remove('active');
        };

        window.toggleCustomDays = function() {
            const freq = document.getElementById('activityFrequency').value;
            const grp  = document.getElementById('customDaysGroup');
            const occGrp = document.getElementById('occasionalDeleteGroup');
            const multiGrp = document.getElementById('allowMultipleGroup');
            if (!grp) return;
            // customDaysGroup is now .ay-inset (flex column); the toggle rows
            // are .ay-toggle-row (flex). Use 'flex' so layouts behave.
            grp.style.display = (freq === 'custom') ? 'flex' : 'none';
            if (occGrp) occGrp.style.display = (freq === 'occasional') ? 'flex' : 'none';
            // Show "allow multiple per day" for all non-occasional frequencies
            if (multiGrp) multiGrp.style.display = (freq !== 'occasional') ? 'flex' : 'none';
        };

        window.setCustomSubtype = function(type) {
            const cycleGrp   = document.getElementById('cycleSubGroup');
            const weekdayGrp = document.getElementById('weekdaySubGroup');
            const btnCycle   = document.getElementById('subtypeCycle');
            const btnDays    = document.getElementById('subtypeDays');
            if (type === 'cycle') {
                // cycleSubGroup is now an .ay-field (flex column) — use flex
                cycleGrp.style.display   = 'flex';
                weekdayGrp.style.display = 'none';
                btnCycle.classList.add('active');
                btnDays.classList.remove('active');
            } else {
                cycleGrp.style.display   = 'none';
                weekdayGrp.style.display = 'flex';
                btnDays.classList.add('active');
                btnCycle.classList.remove('active');
            }
        };

        window.toggleDayBtn = function(btn) {
            btn.classList.toggle('selected');
        };

        // Wire up day picker buttons (new ay-day-btn class as of v120;
        // legacy .day-btn selector retained for any other surfaces that
        // still use the old shape).
        document.querySelectorAll('.ay-day-btn, .day-btn').forEach(btn => {
            btn.addEventListener('click', function() { toggleDayBtn(this); });
        });

        function getSelectedDays() {
            return [...document.querySelectorAll('.ay-day-btn.selected, .day-btn.selected')]
                .map(b => parseInt(b.dataset.day));
        }
        function setSelectedDays(days) {
            document.querySelectorAll('.ay-day-btn, .day-btn').forEach(b => {
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
            // negativeXpSection is now .ay-inset (flex column) — use flex
            document.getElementById('negativeXpSection').style.display = enabled ? 'flex' : 'none';
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

            // Resolve target dim/path from dropdowns.
            // Cases (in order):
            //   1. Dim is uncategorized → top-level uncategorized dim+path
            //   2. Dim is real, path is uncategorized → per-dim Uncategorized path
            //   3. Dim is real, path is real → resolve normally
            //   4. Anything not found → fall back to top-level uncategorized
            const selectedDimId  = document.getElementById('activityDimSelect').value;
            const selectedPathId = document.getElementById('activityPathSelect').value;
            let targetDi, targetPi;
            if (!selectedDimId || selectedDimId === 'uncategorized') {
                const unc = getOrCreateUncategorized();
                targetDi = unc.di; targetPi = unc.pi;
            } else {
                const dims = window.userData.dimensions || [];
                const di = dims.findIndex(d => d.id === selectedDimId);
                if (di === -1) {
                    const unc = getOrCreateUncategorized();
                    targetDi = unc.di; targetPi = unc.pi;
                } else if (!selectedPathId || selectedPathId === 'uncategorized') {
                    // Real dim, uncategorized path — create the per-dim Uncategorized path.
                    targetDi = di;
                    targetPi = getOrCreateUncategorizedPath(di);
                    if (targetPi === -1) {
                        const unc = getOrCreateUncategorized();
                        targetDi = unc.di; targetPi = unc.pi;
                    }
                } else {
                    targetDi = di;
                    const pi = dims[di].paths.findIndex(p => p.id === selectedPathId);
                    if (pi === -1) {
                        // Selected path no longer exists — fall back to per-dim uncategorized
                        targetPi = getOrCreateUncategorizedPath(di);
                        if (targetPi === -1) {
                            const unc = getOrCreateUncategorized();
                            targetDi = unc.di; targetPi = unc.pi;
                        }
                    } else {
                        targetPi = pi;
                    }
                }
            }

            const actFields = { name, baseXP, frequency, description, isNegative, isSkipNegative,
                negativeXpMode, allowMultiplePerDay, customSubtype: subtype, customDays,
                scheduledDays, timesPerCycle, deleteOnComplete };

            // Tech Tree mastery threshold — only read when the field group is
            // visible (accept-as-new flow, or editing an activity that has one).
            let ttMastery = null;
            const ttGrp = document.getElementById('ttMasteryGroup');
            if (ttGrp && ttGrp.style.display !== 'none') {
                const ttCount = Math.max(1, parseInt(document.getElementById('ttMasteryCount').value) || 1);
                const ttWinRaw = document.getElementById('ttMasteryWindow').value;
                const ttWin = ttWinRaw === '' ? null : Math.max(1, parseInt(ttWinRaw) || 30);
                ttMastery = { count: ttCount, windowDays: ttWin };
            }

            const isNewActivity = editingActivityIndex === null;

            if (!isNewActivity) {
                // ── Edit existing ──
                const origDi = editingActivityDimIndex;
                const origPi = editingActivityPathIndex;
                const origAi = editingActivityIndex;
                const activity = window.userData.dimensions[origDi].paths[origPi].activities[origAi];
                Object.assign(activity, actFields);
                if (ttMastery) activity.techTreeMastery = ttMastery;
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
                const newActivity = {
                    id: Date.now().toString(), ...actFields,
                    streak: 0, skipStreak: 0, lastCompleted: null, cycleCompletions: 0,
                    totalXP: 0, completionCount: 0, isFavorite: false,
                    completionHistory: [], cycleHistory: [], streakShields: 0,
                    createdAt: new Date().toISOString()
                };
                if (ttMastery) newActivity.techTreeMastery = ttMastery;
                targetPath.activities.push(newActivity);
                // Tech Tree accept-as-new: resolve the pending node against the
                // activity that was just created (see Tech Tree module below).
                if (window._ttAcceptContext && typeof ttResolveAcceptedNode === 'function') {
                    ttResolveAcceptedNode(newActivity);
                }
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
                // Convert quest subtasks referencing this activity into plain
                // tasks BEFORE the splice so the real name is still resolvable.
                if (actId) cleanupQuestsForActivity(actId);
                window.userData.dimensions[dimIndex].paths[pathIndex].activities.splice(actIndex, 1);
                // Clean up references in challenges
                if (actId) cleanupChallengesForActivity(actId);
                // Clean up references in groups (strip the id from any group's activityIds).
                if (actId) cleanupGroupsForActivity(actId);
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

        // Pure, side-effect-free prediction of what completing `activity`
        // right now would yield. Used by both completeActivity (which
        // actually awards the XP) and completeActivityById (which shows
        // the floating-XP preview just before completion). Single source
        // of truth so the popup amount can't drift from the awarded amount.
        function predictCompletionXP(activity) {
            const isOcc  = activity.frequency === 'occasional';
            const isCust = activity.frequency === 'custom';
            const currentStreak       = isOcc ? 0 : (activity.streak || 0);
            const todayStr            = toLocalDateStr(new Date());
            const cycleWasEmpty       = isCust ? (cycleCompletionsNow(activity) === 0) : false;
            const alreadyGrantedToday = (!isCust && activity.streakGrantedDate === todayStr);
            const shouldGrantStreak   = !isOcc && (isCust ? cycleWasEmpty : !alreadyGrantedToday);
            const newStreak           = isOcc ? 0 : (shouldGrantStreak ? currentStreak + 1 : currentStreak);
            const multiplier          = isOcc ? 1 : calculateConsistencyMultiplier(newStreak);
            const earnedXP            = Math.floor((activity.baseXP || 0) * multiplier);
            return { currentStreak, todayStr, shouldGrantStreak, newStreak, multiplier, earnedXP };
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
            // All XP/streak prediction lives in predictCompletionXP — same code path
            // the floating-XP preview uses, so they can't drift.
            const { currentStreak, todayStr, shouldGrantStreak, newStreak,
                    multiplier: consistencyMultiplier, earnedXP } = predictCompletionXP(activity);
            if (!isOccasional && shouldGrantStreak) {
                activity.streakGrantedDate = todayStr;
                // Stamp the start of a new streak so processStreakSystem's walk
                // cannot bridge across the previous break gap using shields.
                if (currentStreak === 0) {
                    activity.streakStartWindow = todayStr;
                }
            }

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

            // Auto-check quest subtasks linked to this activity
            updateQuestProgressForActivity(activity.id);
            
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

            // Un-check quest subtasks that were auto-checked by this activity today
            undoQuestProgressForActivity(activity.id);

            // Reverse dimension XP for this undo
            const _dimForUndo = window.userData.dimensions[dimIndex];
            if (_dimForUndo) applyDimXP(_dimForUndo, -xpChange);

            updateDashboard();
            showUndoToast(toastXP);
            debouncedSaveUserData(); // fire-and-forget

            // v122 bug fix: if the undone activity is part of an active
            // challenge that the user has nominated to the active group, the
            // group's view of their progress goes stale until the next save.
            // Mirror the completeActivity path: re-sync whenever the activity
            // touched something the group cares about.
            if (window.userData.activeGroupChallengeId) {
                const isInActiveChallenge = (window.userData.challenges || []).some(ch =>
                    ch.status === 'active' &&
                    ((ch.activityIds || []).includes(activity.id) || ch.activityId === activity.id)
                );
                if (isInActiveChallenge && typeof gcSyncProgress === 'function') {
                    gcSyncProgress().catch(() => {});
                }
            }
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

            // v122: if this retroactive change affected a nominated challenge,
            // push the new progress to the active group so members see it.
            if (window.userData.activeGroupChallengeId) {
                const isInActiveChallenge = (window.userData.challenges || []).some(ch =>
                    ch.status === 'active' &&
                    ((ch.activityIds || []).includes(activity.id) || ch.activityId === activity.id)
                );
                if (isInActiveChallenge && typeof gcSyncProgress === 'function') {
                    gcSyncProgress().catch(() => {});
                }
            }
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
            // (Removed: the old occasional-frequency block. The retroactive
            // recalculation path is safe for occasional activities —
            // recomputeStreakFromHistory has an explicit early-return for them,
            // and the other recompute helpers count entries the same way
            // regardless of frequency.)

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
                tone: 'undo',
            });
        }

        function showXPToast(xp, streak, multiplier) {
            const isPos = xp > 0;
            let label = isPos ? `+${Math.abs(xp)} XP` : `−${Math.abs(xp)} XP`;
            // Use SVG icons inline so they pick up the tone color via
            // `currentColor`, matching the rest of the design system.
            // Bolt icon for positive XP, heartbreak fallback for negative.
            const ICON_BOLT  = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M13 2 4.5 13.5h6L10 22l9-13.5h-6L13 2z"/></svg>';
            const ICON_HEART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/><polyline points="12 6 11 15 13 13"/></svg>';
            const icon = isPos ? ICON_BOLT : ICON_HEART;
            if (isPos && streak > 1) { label += ` · ×${streak}`; }
            if (isPos && multiplier > 1) { label += ` · ${multiplier}× boost`; }
            _showToastPill({
                icon,
                label,
                tone: isPos ? 'xp' : 'neg',
            });
        }

        function _showToastPill({ icon, label, accent, border, accentEnd, tone }) {
            // Remove any existing toast so they don't stack
            document.querySelectorAll('.xp-toast-pill').forEach(t => t.remove());

            // Tone determines accent color used for the icon halo and the
            // hairline border. Falls back to "info" (blue) if the caller
            // passed nothing. The old API also accepted custom hex/rgba
            // strings via accent/border — those are still respected but
            // overridden by `tone` when present, since tone keeps us
            // anchored to the locked color-job palette.
            const TONES = {
                xp:    { fg: 'var(--chip-xp-fg)',     ring: 'rgba(74,222,128,0.32)' },
                neg:   { fg: 'var(--color-accent-red)', ring: 'rgba(193,103,103,0.34)' },
                undo:  { fg: 'var(--color-text-secondary)', ring: 'rgba(255,255,255,0.14)' },
                streak:{ fg: 'var(--chip-streak-fg)',  ring: 'rgba(251,146,60,0.34)' },
                info:  { fg: 'var(--color-progress)',  ring: 'rgba(90,159,212,0.32)' },
            };
            const t = TONES[tone] || TONES.info;

            const toast = document.createElement('div');
            toast.className = 'xp-toast-pill';
            // Two-element structure: an icon "dot" with the accent glow,
            // and the label. Both inherit Inter; numerals are tabular.
            toast.innerHTML =
                '<span class="xp-toast-icon" style="color:' + t.fg + ';">' + icon + '</span>' +
                '<span class="xp-toast-label">' + label + '</span>';
            toast.style.setProperty('--toast-ring', t.ring);
            toast.style.setProperty('--toast-fg', t.fg);

            document.body.appendChild(toast);

            // Auto-dismiss after ~2.4s, then fade up.
            setTimeout(() => {
                toast.classList.add('xp-toast-leaving');
                setTimeout(() => toast.remove(), 280);
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
                btn.className = 'level-up-share-btn';
                btn.innerHTML =
                    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                    'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
                    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/>' +
                    '<circle cx="18" cy="19" r="3"/>' +
                    '<line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>' +
                    '<line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>' +
                    '<span>Share progress</span>';
                btn.onclick = () => shareLevelUpCard(newLevel);
                // Reward overlay card takes precedence — it's the richer
                // celebration surface when a real-world reward is configured.
                const card = document.querySelector('#rewardUnlockOverlay .reward-unlock-card');
                if (card) { card.appendChild(btn); return; }
                // Otherwise, drop into the new level-up card if it's open.
                const luCard = document.querySelector('.level-up-card');
                if (luCard && !luCard.querySelector('.level-up-share-btn')) {
                    luCard.appendChild(btn);
                }
            }

            if (reward || newLevel === 100) {
                setTimeout(() => {
                    showRewardUnlock(newLevel);
                    // Inject share button into reward overlay after it opens.
                    // Same canonical class used in the no-reward path so the
                    // celebration UI looks identical across both flows.
                    setTimeout(() => {
                        if (document.getElementById('shareLevelUpBtn')) return;
                        const card = document.querySelector('#rewardUnlockOverlay .reward-unlock-card');
                        if (!card) return;
                        const btn = document.createElement('button');
                        btn.id = 'shareLevelUpBtn';
                        btn.className = 'level-up-share-btn';
                        btn.style.marginTop = '14px';
                        btn.innerHTML =
                            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                            'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
                            '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/>' +
                            '<circle cx="18" cy="19" r="3"/>' +
                            '<line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>' +
                            '<line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>' +
                            '<span>Share progress</span>';
                        btn.onclick = () => shareLevelUpCard(newLevel);
                        card.appendChild(btn);
                    }, 100);
                }, 600);
            } else {
                // ── Level-up celebration card (no reward configured) ──────
                // Uses the canonical card material recipe via .level-up-card
                // and gets a proper close button. The share CTA inherits the
                // app's primary-button style instead of the old purple
                // gradient pill. Auto-dismisses after 9s — extended slightly
                // since there's now a close affordance that lets the user
                // dismiss early. ───────────────────────────────────────────
                // Remove any previous level-up card before showing a new
                // one (rare but defensive — back-to-back level-ups in
                // quick succession).
                const existing = document.getElementById('levelUpToast');
                if (existing) existing.remove();

                const levelUpToast = document.createElement('div');
                levelUpToast.id = 'levelUpToast';
                levelUpToast.className = 'level-up-overlay';
                levelUpToast.setAttribute('role', 'dialog');
                levelUpToast.setAttribute('aria-modal', 'false');

                const card = document.createElement('div');
                card.className = 'level-up-card';

                // Close X — top-right, dismisses immediately and clears the
                // auto-dismiss timer so we don't get a remove() race.
                const closeBtn = document.createElement('button');
                closeBtn.type = 'button';
                closeBtn.className = 'level-up-close';
                closeBtn.setAttribute('aria-label', 'Dismiss');
                closeBtn.innerHTML =
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                    'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
                    '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

                // Eyebrow + emoji + headline + sub
                const eyebrow = document.createElement('div');
                eyebrow.className = 'level-up-eyebrow';
                eyebrow.textContent = 'LEVEL UP';

                const emoji = document.createElement('div');
                emoji.className = 'level-up-emoji';
                emoji.textContent = '🎉';

                const headline = document.createElement('div');
                headline.className = 'level-up-headline';
                headline.textContent = 'Level ' + newLevel;

                // Share button — canonical primary CTA, not a purple pill.
                const shareBtn = document.createElement('button');
                shareBtn.id = 'shareLevelUpBtn';
                shareBtn.type = 'button';
                shareBtn.className = 'level-up-share-btn';
                shareBtn.innerHTML =
                    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                    'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
                    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/>' +
                    '<circle cx="18" cy="19" r="3"/>' +
                    '<line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>' +
                    '<line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>' +
                    '<span>Share progress</span>';
                shareBtn.onclick = function(e) {
                    e.stopPropagation();
                    shareLevelUpCard(newLevel);
                };

                card.appendChild(closeBtn);
                card.appendChild(eyebrow);
                card.appendChild(emoji);
                card.appendChild(headline);
                card.appendChild(shareBtn);
                levelUpToast.appendChild(card);
                document.body.appendChild(levelUpToast);

                // Auto-dismiss
                const dismissTimer = setTimeout(() => {
                    levelUpToast.classList.add('level-up-leaving');
                    setTimeout(() => levelUpToast.remove(), 280);
                }, 9000);

                closeBtn.onclick = function() {
                    clearTimeout(dismissTimer);
                    levelUpToast.classList.add('level-up-leaving');
                    setTimeout(() => levelUpToast.remove(), 280);
                };
                // Also dismiss on backdrop tap (but not when the user taps
                // inside the card itself).
                levelUpToast.onclick = function(e) {
                    if (e.target === levelUpToast) {
                        clearTimeout(dismissTimer);
                        levelUpToast.classList.add('level-up-leaving');
                        setTimeout(() => levelUpToast.remove(), 280);
                    }
                };
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
                const statusLabel = isUnlocked ? '✓ Unlocked' : isCurrent ? 'Current' : 'Upcoming';

                const rewardContent = reward
                    ? `<div class="pf-reward-title">${reward.icon ? escapeHtml(reward.icon) + ' &nbsp;' : ''}${escapeHtml(reward.title)}</div>
                       ${reward.description ? `<div class="pf-reward-desc">${escapeHtml(reward.description)}</div>` : ''}
                       <div class="pf-reward-actions">
                           ${reward.link && isUnlocked ? `<a href="${escapeHtml(reward.link)}" target="_blank" rel="noopener" class="pf-reward-action pf-reward-action-claim">🎁 Claim Reward</a>` : ''}
                           <button class="pf-reward-action" onclick="openRewardModal(${lvl})">Edit</button>
                           <button class="pf-reward-action pf-reward-action-danger" onclick="deleteReward(${lvl})" title="Delete reward">Delete</button>
                       </div>`
                    : lvl === 100
                    ? `<div class="pf-reward-title" style="filter: blur(6px); user-select:none; pointer-events:none;">🌟 &nbsp;A secret message awaits you at Level 100!</div>
                       <div class="pf-reward-desc" style="margin-top:6px;font-style:italic;">Reach Level 100 to reveal your reward.</div>`
                    : `<div class="pf-reward-title pf-reward-title-empty">No reward set yet</div>
                       <div class="pf-reward-actions">
                           <button class="pf-reward-action pf-reward-action-add" onclick="openRewardModal(${lvl})">+ Add reward</button>
                       </div>`;

                html += `
                    <div class="pf-reward-card ${nodeClass}${reward ? ' has-reward' : ''}">
                        <div class="pf-reward-head">
                            <span class="pf-reward-level">Level ${lvl}</span>
                            <span class="pf-reward-badge">${statusLabel}</span>
                        </div>
                        ${rewardContent}
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
                tone: 'streak',
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
            var html = '<div class="pf-quick-add">'
                + '<label class="pf-quick-add-label" for="dimRewardAnyLevelInput">Set reward for any dim level</label>'
                + '<input type="number" id="dimRewardAnyLevelInput" class="pf-quick-add-input" min="2" max="200" placeholder="2–200">'
                + '<button class="pf-quick-add-btn" onclick="openDimRewardForAnyLevel()">Add / Edit</button>'
                + '</div>';

            levelsToShow.forEach(function(lvl) {
                var reward = rewards[lvl];
                var isUnlocked = lvl < currentLevel;
                var isCurrent  = lvl === currentLevel;
                var nodeClass  = isUnlocked ? 'unlocked' : isCurrent ? 'current' : 'future';
                var statusLabel = isUnlocked ? '\u2713 Unlocked' : isCurrent ? 'Current' : 'Upcoming';

                var rewardContent;
                if (reward) {
                    var iconPart = reward.icon ? escapeHtml(reward.icon) + ' &nbsp;' : '';
                    var descPart = reward.description ? '<div class="pf-reward-desc">' + escapeHtml(reward.description) + '</div>' : '';
                    var linkPart = (reward.link && isUnlocked) ? '<a href="' + escapeHtml(reward.link) + '" target="_blank" rel="noopener" class="pf-reward-action pf-reward-action-claim">\ud83c\udf81 Claim Reward</a>' : '';
                    var editPart = '<button class="pf-reward-action" onclick="openDimRewardModal(\'' + escapeHtml(dimId) + '\',' + lvl + ')">Edit</button>'
                        + '<button class="pf-reward-action pf-reward-action-danger" onclick="deleteDimReward(\'' + escapeHtml(dimId) + '\',' + lvl + ')" title="Delete reward">Delete</button>';
                    rewardContent = '<div class="pf-reward-title">' + iconPart + escapeHtml(reward.title) + '</div>'
                        + descPart
                        + '<div class="pf-reward-actions">' + linkPart + editPart + '</div>';
                } else {
                    rewardContent = '<div class="pf-reward-title pf-reward-title-empty">No reward set yet</div>'
                        + '<div class="pf-reward-actions"><button class="pf-reward-action pf-reward-action-add" onclick="openDimRewardModal(\'' + escapeHtml(dimId) + '\',' + lvl + ')">+ Add reward</button></div>';
                }

                html += '<div class="pf-reward-card ' + nodeClass + (reward ? ' has-reward' : '') + '">'
                    + '<div class="pf-reward-head">'
                    + '<span class="pf-reward-level">Dim Level ' + lvl + '</span>'
                    + '<span class="pf-reward-badge">' + statusLabel + '</span>'
                    + '</div>'
                    + rewardContent
                    + '</div>';
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
                        +   '<div class="dim-progress-bar-fill" style="width:' + pct.toFixed(1) + '%;background:' + (DIM_HEX_MAP[dim.color] || '#5a9fd4') + ';box-shadow:0 0 8px ' + (DIM_HEX_MAP[dim.color] || '#5a9fd4') + '55;"></div>'
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
            view: 'all',
            period: 'all',
            dimId: null,
            pathId: null,
            activityId: null,
            chartMode: 'cumulative',
            chartTimeRange: 'all',
            chartOverlays: [],
            hideMain: false,
        };
        window.calendarOffset = 0;
        window.xpChartInstance = null;

        // ── Analytics filter panel toggle ─────────────────────────────
        window.toggleAnalyticsFilterPanel = function() {
            const panel = document.getElementById('analyticsFilters');
            const btn   = document.getElementById('analyticsFilterToggle');
            if (!panel) return;
            const isOpen = panel.style.display !== 'none' && panel.style.display !== '';
            panel.style.display = isOpen ? 'none' : 'flex';
            if (btn) btn.setAttribute('aria-expanded', String(!isOpen));
        };

        // ── Generic collapsible toggle (XP lb, streak lb) ────────────
        window.toggleAnSection = function(bodyId, btnId) {
            const body = document.getElementById(bodyId);
            const btn  = document.getElementById(btnId);
            if (!body) return;
            const isOpen = body.classList.contains('open');
            body.classList.toggle('open', !isOpen);
            if (btn) btn.classList.toggle('open', !isOpen);
        };

        // ── Hide-Overall chart toggle ─────────────────────────────────
        window.toggleChartHideMain = function(checked) {
            window.analyticsState.hideMain = !!checked;
            renderXPChart(window._analyticsFullLog);
        };

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
            // support both new an-mode-tabs and legacy filter-pills
            const parent = btn.closest('.an-mode-tabs') || btn.closest('.filter-pills');
            if (parent) {
                parent.querySelectorAll('.an-mode-tab, .filter-pill').forEach(p => p.classList.remove('active'));
            }
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
                        // (Removed the `act.frequency === 'occasional'` filter
                        // so all activities — daily, weekly, custom, occasional,
                        // one-time — are searchable and addable for past dates.)
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
            const positiveLog = log.filter(e => !e.isPenalty && (e.xp || 0) > 0);

            const logXP = positiveLog.reduce((s, e) => s + (e.xp || 0), 0);
            const isAllScope  = window.analyticsState.view   === 'all';
            const isAllPeriod = window.analyticsState.period === 'all';
            const ghostXP = (isAllScope && isAllPeriod) ? (window.userData.xpDeletedGhost || 0) : 0;
            const totalXP = logXP + ghostXP;
            const totalCompletions = positiveLog.length;

            // XP today — live from period log
            const todayStr = localToday();
            const xpToday = positiveLog
                .filter(e => e.date && toLocalDateStr(e.date) === todayStr)
                .reduce((s, e) => s + (e.xp || 0), 0)
                + ((window.userData.xpTodayGhost || {})[todayStr] || 0);

            const weeklyXP  = computeWeeklyXPFromActivities(activities);
            const xpPerHour = computeXPPerHour(activities);

            // Highest LIVE (current) streak, not historic best
            const highestStreak = activities.reduce((s, a) => Math.max(s, a.streak || 0), 0);

            const ic = {
                xp:    `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
                check: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
                clock: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
                cal:   `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
                rate:  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
                fire:  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`,
            };

            const rows = [
                [
                    { v: totalXP.toLocaleString(),          l: 'Total XP Earned',  icon: ic.xp,    accent: 'green' },
                    { v: totalCompletions.toLocaleString(), l: 'Total Completions', icon: ic.check, accent: 'blue'  },
                ],
                [
                    { v: xpToday.toLocaleString(),          l: 'XP Today',         icon: ic.clock, accent: 'green' },
                    { v: weeklyXP.toLocaleString(),         l: 'XP This Week',     icon: ic.cal,   accent: 'green' },
                ],
                [
                    { v: xpPerHour.toLocaleString(),        l: 'XP / Hour',        icon: ic.rate,  accent: 'amber' },
                    { v: highestStreak,                     l: 'Highest Streak',   icon: ic.fire,  accent: 'coral' },
                ],
            ];

            const el = document.getElementById('analyticsSummary');
            if (!el) return;
            el.innerHTML = rows.map(row => `
                <div class="an-stat-row">
                    ${row.map(s => `
                    <div class="an-stat-card an-stat-${s.accent}">
                        <div class="an-stat-icon">${s.icon}</div>
                        <div class="an-stat-value">${s.v}</div>
                        <div class="an-stat-label">${s.l}</div>
                    </div>`).join('')}
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
            const parent = btn.closest('.an-range-selector') || btn.closest('.filter-pills');
            if (parent) {
                parent.querySelectorAll('.an-range-btn, .filter-pill').forEach(p => p.classList.remove('active'));
            }
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

            // ── Defer until the canvas is actually laid out ──────────────
            // When the analytics tab has just become visible (display:none
            // → display:block via .tab-content.active), getBoundingClientRect
            // can return 0×0 because the browser hasn't flushed style+layout
            // yet. Drawing at the 600×220 fallback then stretches the canvas
            // to fit the container — the chart looks blank or blurry. Defer
            // to the next animation frame so layout has flushed.
            const probeRect = canvas.getBoundingClientRect();
            const probeW = probeRect.width > 0 ? probeRect.width : canvas.offsetWidth;
            if (probeW <= 1) {
                // Stash the log so the deferred re-render gets the same input.
                requestAnimationFrame(() => renderXPChart(fullLog));
                return;
            }

            // ── Wire up a one-time ResizeObserver so future container size
            // changes (window resize, sidebar collapse, etc.) trigger a
            // re-render automatically. We attach to the .chart-container
            // parent — the canvas itself is intrinsically sized by CSS so
            // its own resize fires after the parent's. ─────────────────
            if (!canvas._xpChartObserver && window.ResizeObserver) {
                const parent = canvas.parentElement;
                if (parent) {
                    let _resizeRaf = null;
                    const ro = new ResizeObserver(() => {
                        if (_resizeRaf) cancelAnimationFrame(_resizeRaf);
                        _resizeRaf = requestAnimationFrame(() => {
                            if (window._analyticsFullLog && parent.offsetWidth > 1) {
                                renderXPChart(window._analyticsFullLog);
                            }
                        });
                    });
                    ro.observe(parent);
                    canvas._xpChartObserver = ro;
                }
            }

            const mode      = window.analyticsState.chartMode;
            const timeRange = window.analyticsState.chartTimeRange || 'all';
            const overlays  = window.analyticsState.chartOverlays  || [];
            const hideMain  = !!(window.analyticsState.hideMain);

            // ── Build series ──────────────────────────────────────────────
            const mainLog    = filterByTimeRange(fullLog || [], timeRange);
            const mainPoints = buildSeriesPoints(mainLog, mode);

            const allSeries = [
                { points: mainPoints, color: CHART_LINE_COLORS[0], fillColor: CHART_FILL_COLORS[0], label: 'Overall', isMain: true },
                ...overlays.map((ov, i) => {
                    const ovLog    = filterByTimeRange(buildOverlayLog(ov), timeRange);
                    const ovPoints = buildSeriesPoints(ovLog, mode);
                    return {
                        points:    ovPoints,
                        color:     CHART_LINE_COLORS[i + 1]    || CHART_LINE_COLORS[4],
                        fillColor: CHART_FILL_COLORS[i + 1]    || CHART_FILL_COLORS[4],
                        label:     ov.label,
                        isMain:    false,
                    };
                }),
            ];

            // When hideMain is on and overlays exist, remove the Overall series
            const seriesData = allSeries
                .filter(s => !(s.isMain && hideMain && overlays.length > 0))
                .filter(s => s.points.length > 0);

            if (!seriesData.length) {
                canvas.style.display  = 'none';
                empty.style.display   = 'flex';
                if (legendEl) legendEl.style.display = 'none';
                return;
            }
            empty.style.display  = 'none';
            canvas.style.display = 'block';

            // ── Canvas sizing ─────────────────────────────────────────────
            // Buffer is multiplied by devicePixelRatio so lines stay crisp
            // on retina/HiDPI displays. We then scale the drawing context
            // back to CSS-pixel space, so the rest of the rendering code
            // can work in plain CSS pixels. The CSS rule
            //   .chart-container canvas { width: 100% !important; height: 100% !important; }
            // handles display sizing — we only touch the pixel buffer.
            const _rect = canvas.getBoundingClientRect();
            const W = (_rect.width  > 0 ? _rect.width  : canvas.offsetWidth)  || 600;
            const H = (_rect.height > 0 ? _rect.height : canvas.offsetHeight) || 220;
            const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
            canvas.width  = Math.round(W * dpr);
            canvas.height = Math.round(H * dpr);
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // CSS-pixel coordinates
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
            const py = v => pad.top  + cH - ((v - minVal) / valRange) * cH;
            // px was the missing piece — without it, every chart draw threw
            // a ReferenceError that the outer try/catch silently swallowed,
            // leaving both Cumulative and Daily views blank.
            const px = d => pad.left + ((+d - minDate) / dateRange) * cW;

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
            const xpMap = {};
            log.forEach(e => { xpMap[e.activityId] = (xpMap[e.activityId] || 0) + e.xp; });
            activities.forEach(a => { if (!xpMap[a.id] && a.totalXP) xpMap[a.id] = a.totalXP; });
            const ranked = activities
                .filter(a => xpMap[a.id])
                .sort((a,b) => (xpMap[b.id]||0) - (xpMap[a.id]||0))
                .slice(0, 10);
            if (ranked.length === 0) { el.innerHTML = '<div class="empty-state" style="padding:20px 0"><p>No data yet</p></div>'; return; }
            const max = xpMap[ranked[0].id] || 1;
            const medalSvg = (stroke) => `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-left:3px;"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>`;
            el.innerHTML = ranked.map((a, i) => {
                const dimColor = DIM_HEX_MAP[a.dimColor] || '#5a9fd4';
                const pct = ((xpMap[a.id]||0) / max * 100).toFixed(1);
                const badge = i === 0 ? medalSvg('#f5c563') : i === 1 ? medalSvg('#b0b8c8') : i === 2 ? medalSvg('#b08060') : '';
                return `<div class="rank-row">
                    <span class="rank-num">#${i+1}</span>
                    <span class="rank-label" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}${badge}</span>
                    <div class="rank-bar-track">
                        <div class="rank-bar-fill" style="width:${pct}%;background:${dimColor};box-shadow:0 0 6px ${dimColor}55;"></div>
                    </div>
                    <span class="rank-value">${(xpMap[a.id]||0).toLocaleString()} XP</span>
                </div>`;
            }).join('');
        }

        // ── Streak Board ─────────────────────────────────────────────────

        function renderStreakBoard(activities) {
            const el = document.getElementById('streakBoard');
            const ranked = [...activities]
                .filter(a => (a.streak || 0) > 0)
                .sort((a,b) => (b.streak||0) - (a.streak||0))
                .slice(0, 10);
            if (!ranked.length) { el.innerHTML = '<div class="empty-state" style="padding:20px 0"><p>No streaks yet</p></div>'; return; }
            const max = ranked[0].streak || 1;
            const fireSvg = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--chip-streak-fg)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-left:2px;"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`;
            el.innerHTML = ranked.map((a, i) => {
                const dimColor = DIM_HEX_MAP[a.dimColor] || '#fb923c';
                const pct = ((a.streak||0) / max * 100).toFixed(1);
                return `<div class="rank-row">
                    <span class="rank-num">#${i+1}</span>
                    <span class="rank-label" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</span>
                    <div class="rank-bar-track">
                        <div class="rank-bar-fill" style="width:${pct}%;background:${dimColor};box-shadow:0 0 6px ${dimColor}55;"></div>
                    </div>
                    <span class="rank-value">${a.streak}d ${fireSvg}</span>
                </div>`;
            }).join('');
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
            const positiveLog = log.filter(e => !e.isPenalty && (e.xp || 0) > 0);
            const countMap = {};
            positiveLog.forEach(e => { countMap[e.activityId] = (countMap[e.activityId] || 0) + 1; });
            const ranked = activities
                .filter(a => countMap[a.id] > 0)
                .sort((a, b) => (countMap[b.id] || 0) - (countMap[a.id] || 0));
            if (ranked.length === 0) { el.innerHTML = '<div class="empty-state" style="padding:20px 0"><p>No data yet</p></div>'; return; }
            const max = countMap[ranked[0].id] || 1;
            const medalSvg = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#f5c563" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-left:3px;"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>`;
            el.innerHTML = ranked.map((a, i) => {
                const dimColor = DIM_HEX_MAP[a.dimColor] || '#5a9fd4';
                const pct = ((countMap[a.id] || 0) / max * 100).toFixed(1);
                return `<div class="rank-row">
                    <span class="rank-label" style="width:130px;" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}${i === 0 ? medalSvg : ''}</span>
                    <div class="rank-bar-track">
                        <div class="rank-bar-fill" style="width:${pct}%;background:${dimColor};box-shadow:0 0 5px ${dimColor}44;"></div>
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
                const intensity = count > 0 ? 0.18 + (count / maxCount) * 0.70 : 0;
                // Use --color-progress RGB (90,159,212) for calendar heat
                const bg = count > 0 ? `rgba(90,159,212,${intensity.toFixed(2)})` : '';
                html += `<div class="calendar-day ${count>0?'has-data':''} ${isToday?'today':''}"
                    style="${bg?'background:'+bg+';':''}"
                    ${count>0 ? `onclick="toggleCalTip(this,'${dateStr}',${count})"` : ''}>
                    <span style="font-size:10px;color:${count>0?'rgba(255,255,255,0.95)':'var(--color-text-secondary)'};">${d}</span>
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
            if (!body) return;
            const isOpen = body.classList.toggle('open');
            if (btn) btn.classList.toggle('open', isOpen);
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

            // ── Layout contract ───────────────────────────────────────────
            // Each row is a 60/40 grid. Left 60% holds 3 stacked text lines:
            //   1. Activity name (+ status check when done)
            //   2. XP + streak chip
            //   3. Frequency · Path breadcrumb
            // Right 40% holds the action column — Do and Undo can coexist
            // for multi-times-a-day activities (do another / undo last one).
            // Column widths are CSS-fixed so completion never reflows the row.
            results.innerHTML = filtered.map(act => {
                const done = isCompletedToday(act);
                const canDo = canCompleteActivity(act) && !done;
                const hasToday = countCompletionsToday(act) > 0;

                const statusIcon = done
                    ? `<span class="search-result-status" aria-label="Completed today"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>`
                    : '';

                // Streak chip — second line, next to XP
                const streakChip = act.streak > 0
                    ? `<span class="search-result-streak"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>${act.streak}</span>`
                    : '';

                const doBtn = canDo
                    ? `<button class="btn-search-do" onclick="searchCompleteActivity(${act._di},${act._pi},${act._ai})" title="Complete">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        Do
                       </button>`
                    : '';
                const undoBtn = hasToday
                    ? `<button class="btn-search-undo" onclick="searchUndoActivity(${act._di},${act._pi},${act._ai})" title="Undo last">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>
                        Undo
                       </button>`
                    : '';

                return `<div class="search-result-item${done ? ' completed' : ''}">
                    <div class="search-result-content">
                        <div class="search-result-name">${statusIcon}<span class="search-result-name-text">${escapeHtml(act.name)}</span></div>
                        <div class="search-result-stats">
                            <span class="search-result-xp">+${act.baseXP} XP</span>
                            ${streakChip}
                        </div>
                        <div class="search-result-meta">
                            <span class="search-result-freq">${freqLabel[act.frequency]||act.frequency}</span>
                            <span class="search-result-dot">·</span>
                            <span class="search-result-path">${escapeHtml(act._dimName)} › ${escapeHtml(act._pathName)}</span>
                        </div>
                    </div>
                    <div class="search-result-actions">${doBtn}${undoBtn}</div>
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
                tone: isShieldTier ? 'info' : 'streak',
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
                // If user has a persisted last-opened sub-tab and it differs
                // from the currently-active pill, switch to it.
                var persistedSub = (window.userData && window.userData.settings && window.userData.settings.activitiesLastSubTab) || null;
                if (persistedSub === 'myActivities' || persistedSub === 'categories' || persistedSub === 'quests') {
                    var activePill = document.querySelector('#activitiesSubTabs .sub-tab.active');
                    var activeName = null;
                    if (activePill) {
                        var m = activePill.getAttribute('onclick').match(/switchSubTab\('activities','(\w+)'\)/);
                        if (m) activeName = m[1];
                    }
                    if (activeName !== persistedSub && typeof switchSubTab === 'function') {
                        switchSubTab('activities', persistedSub);
                        return; // switchSubTab handles its own render
                    }
                }
                var activeSub = document.querySelector('#activitiesSubTabs .sub-tab.active');
                if (activeSub) {
                    var subName = activeSub.getAttribute('onclick').match(/switchSubTab\('activities','(\w+)'\)/);
                    if (subName && subName[1] === 'categories') renderDimensions();
                    else if (subName && subName[1] === 'quests') renderQuestsTab();
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
            if (parentTab === 'activities' && subTab === 'quests') renderQuestsTab();

            // Persist the last-opened sub-tab on the Activities parent so it
            // becomes the default on next login.
            if (parentTab === 'activities' && (subTab === 'myActivities' || subTab === 'categories' || subTab === 'quests')) {
                if (window.userData) {
                    if (!window.userData.settings) window.userData.settings = {};
                    window.userData.settings.activitiesLastSubTab = subTab;
                    if (typeof saveUserData === 'function') saveUserData().catch(function(){});
                }
            }
        };

        // ── Profile Rewards toggle ───────────────────────────────────────
        window.toggleProfileRewards = function() {
            var body = document.getElementById('profileRewardsBody');
            var btn  = document.getElementById('profileRewardsToggleBtn');
            if (!body) return;
            var isOpen = body.style.display !== 'none';
            body.style.display = isOpen ? 'none' : 'block';
            if (btn) btn.classList.toggle('open', !isOpen);
            // Render rewards content when opening
            if (!isOpen) {
                renderRewards();
            }
        };

        // ── Profile info-hint toggle (rewards / life balance) ────────────
        window.toggleProfileInfo = function(which) {
            var id  = which === 'rewards' ? 'profileRewardsInfo' : 'profileLifeInfo';
            var hint = document.getElementById(id);
            if (!hint) return;
            hint.hidden = !hint.hidden;
            // Toggle is-open on the trigger button for visual state
            var btns = document.querySelectorAll('.pf-info-btn[onclick*="' + which + '"]');
            btns.forEach(function(b) { b.classList.toggle('is-open', !hint.hidden); });
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

            // Title above strip — full, friendly day name. "Today, Fri May 20" on
            // today, plain "Fri May 20, 2026" on any other date so the year is
            // visible when scrolling far from today.
            var titleEl = document.getElementById('plannerCalTitle');
            if (titleEl) {
                if (dateStr === todayStr) {
                    titleEl.textContent = 'Today · ' + formatPlannerDate(dateStr);
                } else {
                    titleEl.textContent = formatPlannerDateFull(dateStr);
                }
            }

            // Date picker sync (still used by the calendar icon for far jumps)
            var picker = document.getElementById('plannerDatePicker');
            if (picker) picker.value = dateStr;

            // "Today" jump button — visible only when not on today
            var todayBtn = document.getElementById('plannerTodayBtn');
            if (todayBtn) todayBtn.style.display = dateStr === todayStr ? 'none' : '';

            // Render the calendar strip and center on the selected day
            renderPlannerCalStrip(dateStr, todayStr);

            // Merge recurring + day-specific items
            ensurePlannerData();
            var dayData = getPlannerDay(dateStr);
            var skipSet = new Set(dayData.skipRecurring || []);
            // Per-day completion of recurring slots — stored as { recId: true }
            // so each slot tracks its own state. Falls back to {} on legacy data.
            if (!dayData.completedRecurring) dayData.completedRecurring = {};
            var merged = [];

            (window.userData.planner.recurring || []).forEach(function(rec) {
                if (skipSet.has(rec.id)) return;
                merged.push({
                    id: rec.id,
                    activityId: rec.activityId || null,
                    time: rec.time || '',
                    title: rec.title || '',
                    isRecurring: true,
                    completed: !!dayData.completedRecurring[rec.id]
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

            // (Removed activity-level override that previously forced every
            //  slot for an activity to share one completion state. Slots are
            //  now independent — completing one slot does not auto-tick others.)

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
                // Onboarding-empty: short explanation, no CTA here — the
                // "+ Schedule" button in the title row above is the entry point.
                var isToday0 = dateStr === todayStr;
                var emptyTitle = isToday0 ? 'Plan your day' : 'Nothing scheduled';
                container.innerHTML = '<div class="planner-empty">'
                    + '<div class="planner-empty-icon">📋</div>'
                    + '<div class="planner-empty-title">' + emptyTitle + '</div>'
                    + '<div class="planner-empty-body">Sequence your day — drop activities and notes into a timeline, then check them off as you go. Recurring items repeat every day automatically.</div>'
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
                // Per-slot completion — only THIS slot ticks, even if the
                // activity is multi-per-day. Other slots stay tappable.
                clickAction = "plannerCompleteSlot('" + item.id + "','" + item.activityId + "'," + (item.isRecurring ? 'true' : 'false') + ")";
            }

            var undoHtml = '';
            if (isActivity && isToday && item.completed) {
                undoHtml = '<button class="planner-undo" onclick="event.stopPropagation();plannerUndoSlot(\'' + item.id + '\',\'' + item.activityId + '\',' + (item.isRecurring ? 'true' : 'false') + ')" title="Undo">'
                    + '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>'
                    + '<span>Undo</span>'
                    + '</button>';
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
                // Recurring badge removed — the "↻" looked like a secondary
                // undo button and the repeat-daily intent is already implicit
                // in the data. Surface it elsewhere later if needed.
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

        // Long-form: "Friday, May 20, 2026" — shown when the user has navigated
        // away from today (year is meaningful then).
        function formatPlannerDateFull(dateStr) {
            var d = new Date(dateStr + 'T12:00:00');
            var todayStr = localDateStr();
            var todayYear = new Date(todayStr + 'T12:00:00').getFullYear();
            var sameYear = d.getFullYear() === todayYear;
            var opts = sameYear
                ? { weekday: 'long', month: 'short', day: 'numeric' }
                : { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' };
            return d.toLocaleDateString(undefined, opts);
        }

        // ── Calendar strip ─────────────────────────────────────────────────
        // Builds 21 days centered on the selected date (10 back, 10 forward),
        // plus extension on either side if the user has scrolled far. Auto-
        // centers the selected day on render.
        function renderPlannerCalStrip(selectedDateStr, todayStr) {
            var container = document.getElementById('plannerCalStrip');
            if (!container) return;

            var WD = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
            var MO = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

            // Window: 14 days back, 14 forward → 29 chips visible in the strip.
            var DAYS_BACK = 14;
            var DAYS_FWD  = 14;
            var center = new Date(selectedDateStr + 'T12:00:00');

            var html = '';
            var lastMonth = -1;
            for (var i = -DAYS_BACK; i <= DAYS_FWD; i++) {
                var d = new Date(center.getTime());
                d.setDate(d.getDate() + i);
                var iso = localDateStr(d);
                var wd  = d.getDay();
                var dn  = d.getDate();
                var mo  = d.getMonth();
                var isSelected = (iso === selectedDateStr);
                var isToday    = (iso === todayStr);

                // Insert a month divider whenever the month changes (but not at
                // the very start of the strip).
                if (lastMonth !== -1 && mo !== lastMonth) {
                    html += '<div class="planner-cal-month" aria-hidden="true">' + MO[mo] + '</div>';
                }
                lastMonth = mo;

                var cls = 'planner-cal-day';
                if (isSelected) cls += ' is-selected';
                if (isToday)    cls += ' is-today';

                html += '<button class="' + cls + '"'
                     + ' data-iso="' + iso + '"'
                     + ' onclick="setPlannerDate(\'' + iso + '\')"'
                     + ' aria-label="' + d.toLocaleDateString(undefined, {weekday:'long', month:'long', day:'numeric'}) + '"'
                     + (isSelected ? ' aria-current="date"' : '')
                     + '>'
                     + '<span class="planner-cal-wd">' + WD[wd] + '</span>'
                     + '<span class="planner-cal-dn">' + dn + '</span>'
                     + '</button>';
            }
            container.innerHTML = html;

            // Center the selected chip in the visible viewport.
            // requestAnimationFrame so layout has stabilised first.
            requestAnimationFrame(function() {
                var sel = container.querySelector('.planner-cal-day.is-selected');
                if (!sel) return;
                var stripCenter = container.clientWidth / 2;
                var chipCenter  = sel.offsetLeft + (sel.offsetWidth / 2);
                container.scrollLeft = Math.max(0, chipCenter - stripCenter);
            });
        }

        // Calendar icon opens the native date picker. showPicker() is the
        // modern API; we fall back to focus+click for older browsers.
        window.openPlannerDatePicker = function() {
            var p = document.getElementById('plannerDatePicker');
            if (!p) return;
            try {
                if (typeof p.showPicker === 'function') { p.showPicker(); return; }
            } catch (e) { /* showPicker may throw on iOS — fall through */ }
            p.focus();
            p.click();
        };

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

        // ══════════════════════════════════════════════════════════════════
        // ── Groups — data model & helpers ──────────────────────────────────
        // ══════════════════════════════════════════════════════════════════
        // Groups bundle activities into time-aware "blocks of life" (Morning
        // Routine, Wind Down, etc). Each activity belongs to at most one group.
        // Stored at userData.groups as an array of:
        //   { id, name, color, timeStart, timeEnd, activityIds[], collapsed,
        //     createdAt }
        // timeStart/timeEnd are "HH:MM" strings (24h) or null for all-day.
        // Migration-safe: existing users have no groups field → getGroups()
        // returns []. First write initializes the array.

        function getGroups() {
            return _dedupeGroupsArr(window.userData && window.userData.groups);
        }

        // Defensive dedupe — fixes data corruption from earlier double-save
        // bug. Runs every read; idempotent. Strategy:
        //   1. By ID first (exact dupes from any cause).
        //   2. Then by name+timeStart+timeEnd signature: if two groups look
        //      like the "same routine," merge their activityIds into the
        //      first occurrence and drop the rest. Keeps the user's data
        //      stable across reads — the merge mutates window.userData so
        //      the next save persists the clean state.
        function _dedupeGroupsArr(arr) {
            if (!Array.isArray(arr) || arr.length === 0) return arr || [];
            // Pass 1: dedupe by id
            var seenIds = new Set();
            var byId = [];
            for (var i = 0; i < arr.length; i++) {
                var g = arr[i];
                if (!g || !g.id) continue;
                if (seenIds.has(g.id)) continue;
                seenIds.add(g.id);
                byId.push(g);
            }
            // Pass 2: dedupe by name + time window. Merge activityIds.
            var sigMap = {}; // sig → first-group-index in `out`
            var out = [];
            for (var j = 0; j < byId.length; j++) {
                var grp = byId[j];
                var sig = (grp.name || '').trim().toLowerCase()
                    + '|' + (grp.timeStart || '') + '|' + (grp.timeEnd || '');
                if (sigMap.hasOwnProperty(sig)) {
                    var primary = out[sigMap[sig]];
                    if (!Array.isArray(primary.activityIds)) primary.activityIds = [];
                    (grp.activityIds || []).forEach(function(aid) {
                        if (primary.activityIds.indexOf(aid) === -1) {
                            primary.activityIds.push(aid);
                        }
                    });
                } else {
                    sigMap[sig] = out.length;
                    out.push(grp);
                }
            }
            // Persist the clean array back in place so the next saveUserData
            // writes deduped data to Firestore. Only mutate if we actually
            // collapsed something — avoid needless cache invalidation.
            if (window.userData && out.length !== arr.length) {
                window.userData.groups = out;
            }
            return out;
        }

        function findGroupById(groupId) {
            if (!groupId) return null;
            var groups = getGroups();
            for (var i = 0; i < groups.length; i++) {
                if (groups[i].id === groupId) return groups[i];
            }
            return null;
        }

        function findGroupForActivity(activityId) {
            if (!activityId) return null;
            var groups = getGroups();
            for (var i = 0; i < groups.length; i++) {
                var ids = groups[i].activityIds || [];
                if (ids.indexOf(activityId) !== -1) return groups[i];
            }
            return null;
        }

        // "HH:MM" → minutes since midnight; null/empty/malformed → -1
        function _groupTimeToMin(s) {
            if (!s || typeof s !== 'string') return -1;
            var parts = s.split(':');
            if (parts.length !== 2) return -1;
            var h = parseInt(parts[0], 10);
            var m = parseInt(parts[1], 10);
            if (isNaN(h) || isNaN(m)) return -1;
            return h * 60 + m;
        }

        // Is "now" strictly inside the group's active window?
        // Wrap-around windows (e.g. 22:00 → 02:00) are supported. All-day
        // groups (no times) are NEVER "in window" — used only by callers that
        // need strict containment. For the canonical "which group does the
        // app showcase right now," use getActiveGroupId, which picks the
        // temporally CLOSEST timed group even outside its window.
        function isGroupActiveNow(group, nowDate) {
            if (!group) return false;
            var s = _groupTimeToMin(group.timeStart);
            var e = _groupTimeToMin(group.timeEnd);
            if (s < 0 || e < 0) return false;
            var d = nowDate || new Date();
            var nowMin = d.getHours() * 60 + d.getMinutes();
            if (s === e) return nowMin === s;
            if (s < e) return nowMin >= s && nowMin < e;
            return nowMin >= s || nowMin < e; // wraps midnight
        }

        // Distance (minutes) from now to a group's nearest window edge on the
        // 24h cycle. 0 if now is inside the window. Infinity for all-day.
        function _cyclicDist(a, b) {
            var d = Math.abs(a - b);
            return Math.min(d, 1440 - d);
        }
        function _groupDistanceFromNow(group, nowMin) {
            var s = _groupTimeToMin(group.timeStart);
            var e = _groupTimeToMin(group.timeEnd);
            if (s < 0 || e < 0) return Infinity;
            var inside;
            if (s === e) inside = (nowMin === s);
            else if (s < e) inside = (nowMin >= s && nowMin < e);
            else inside = (nowMin >= s || nowMin < e);
            if (inside) return 0;
            return Math.min(_cyclicDist(nowMin, s), _cyclicDist(nowMin, e));
        }

        // Id of the timed group temporally CLOSEST to "now" — by edge
        // distance on the 24h clock. With R1 5–6 PM and R2 7–8 PM, R1 wins
        // up to 6:30 PM (midpoint), then R2 takes over. Inside-window
        // groups always win (distance 0). Returns null only when the user
        // has no timed groups at all.
        function getActiveGroupId(nowDate) {
            var d = nowDate || new Date();
            var nowMin = d.getHours() * 60 + d.getMinutes();
            var groups = getGroups();
            var bestId = null;
            var bestDist = Infinity;
            for (var i = 0; i < groups.length; i++) {
                var dist = _groupDistanceFromNow(groups[i], nowMin);
                if (dist < bestDist) { bestDist = dist; bestId = groups[i].id; }
            }
            return bestId;
        }

        // Kept for back-compat with anything that imports it. With the new
        // closest-by-distance rule, "upcoming" collapses into "active".
        function getNextUpcomingGroupId(nowDate) {
            return getActiveGroupId(nowDate);
        }

        // Activities in a group, in stored order. Deleted/missing ids dropped.
        function getActivitiesInGroup(groupId) {
            var g = findGroupById(groupId);
            if (!g) return [];
            var ids = g.activityIds || [];
            var out = [];
            for (var i = 0; i < ids.length; i++) {
                var act = findActivityById(ids[i]);
                if (act) out.push(act);
            }
            return out;
        }

        // All groups containing a given activity. Used for multi-group
        // membership (activities with allowMultiplePerDay can be in many).
        function findGroupsForActivity(activityId) {
            if (!activityId) return [];
            var groups = getGroups();
            var out = [];
            for (var i = 0; i < groups.length; i++) {
                var ids = groups[i].activityIds || [];
                if (ids.indexOf(activityId) !== -1) out.push(groups[i]);
            }
            return out;
        }

        // ── Mutators — caller is responsible for saveUserData() ─────────
        function _ensureGroupsArr() {
            if (!window.userData) return null;
            if (!Array.isArray(window.userData.groups)) window.userData.groups = [];
            return window.userData.groups;
        }

        function addGroup(opts) {
            var arr = _ensureGroupsArr();
            if (!arr) return null;
            var g = {
                id: 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                name: (opts && opts.name) || 'New group',
                color: (opts && opts.color) || 'blue',
                timeStart: (opts && opts.timeStart) || null,
                timeEnd: (opts && opts.timeEnd) || null,
                activityIds: (opts && opts.activityIds) ? opts.activityIds.slice() : [],
                collapsed: false,
                createdAt: new Date().toISOString()
            };
            arr.push(g);
            return g;
        }

        function updateGroup(groupId, patch) {
            var g = findGroupById(groupId);
            if (!g || !patch) return null;
            if ('name'      in patch) g.name      = patch.name;
            if ('color'     in patch) g.color     = patch.color;
            if ('timeStart' in patch) g.timeStart = patch.timeStart;
            if ('timeEnd'   in patch) g.timeEnd   = patch.timeEnd;
            if ('collapsed' in patch) g.collapsed = !!patch.collapsed;
            if ('activityIds' in patch && Array.isArray(patch.activityIds)) {
                g.activityIds = patch.activityIds.slice();
            }
            return g;
        }

        function deleteGroup(groupId) {
            var arr = _ensureGroupsArr();
            if (!arr) return false;
            for (var i = 0; i < arr.length; i++) {
                if (arr[i].id === groupId) { arr.splice(i, 1); return true; }
            }
            return false;
        }

        // True if an activity can be a member of multiple groups at once.
        // Repeatable activities (allowMultiplePerDay=true AND not occasional)
        // earn this privilege — e.g., "Drink water" can show up in both
        // Morning Routine AND Wind Down without losing its place.
        function activityAllowsMultiGroup(activity) {
            if (!activity) return false;
            return !!activity.allowMultiplePerDay
                && activity.frequency !== 'occasional';
        }

        // Set membership for one (activity, group) pair.
        //   isInTarget=true  → activity is in targetGroupId
        //   isInTarget=false → activity is NOT in targetGroupId
        // For single-group activities, "true" strips membership from all
        // OTHER groups (exclusive). For multi-group activities, only the
        // targetGroupId's membership is touched (additive).
        function setGroupMembership(activityId, targetGroupId, isInTarget) {
            if (!targetGroupId) return false;
            var target = findGroupById(targetGroupId);
            if (!target) return false;
            if (!Array.isArray(target.activityIds)) target.activityIds = [];

            if (isInTarget) {
                var act = findActivityById(activityId);
                var multi = activityAllowsMultiGroup(act);
                if (!multi) {
                    // Single-group: strip from other groups before adding.
                    var groups = getGroups();
                    for (var i = 0; i < groups.length; i++) {
                        if (groups[i].id === targetGroupId) continue;
                        var ids = groups[i].activityIds || [];
                        var idx = ids.indexOf(activityId);
                        if (idx !== -1) ids.splice(idx, 1);
                    }
                }
                if (target.activityIds.indexOf(activityId) === -1) {
                    target.activityIds.push(activityId);
                }
            } else {
                var existing = target.activityIds.indexOf(activityId);
                if (existing !== -1) target.activityIds.splice(existing, 1);
            }
            return true;
        }

        // Legacy single-group setter — strips activity from ALL groups, then
        // adds to target (or null to clear). Used by older code paths.
        function setActivityGroup(activityId, groupId) {
            var groups = getGroups();
            for (var i = 0; i < groups.length; i++) {
                var ids = groups[i].activityIds || [];
                var idx = ids.indexOf(activityId);
                if (idx !== -1) ids.splice(idx, 1);
            }
            if (groupId) {
                var g = findGroupById(groupId);
                if (!g) return false;
                if (!Array.isArray(g.activityIds)) g.activityIds = [];
                g.activityIds.push(activityId);
            }
            return true;
        }

        // Strip an activity id from any group references. Call from the
        // activity-delete path so groups don't accumulate stale ids.
        function cleanupGroupsForActivity(activityId) {
            var groups = getGroups();
            var dirty = false;
            for (var i = 0; i < groups.length; i++) {
                var ids = groups[i].activityIds || [];
                var idx = ids.indexOf(activityId);
                if (idx !== -1) { ids.splice(idx, 1); dirty = true; }
            }
            return dirty;
        }

        // Expose for cross-section access and console debugging.
        window.getGroups               = getGroups;
        window.findGroupById           = findGroupById;
        window.findGroupForActivity    = findGroupForActivity;
        window.findGroupsForActivity   = findGroupsForActivity;
        window.isGroupActiveNow        = isGroupActiveNow;
        window.getActiveGroupId        = getActiveGroupId;
        window.getNextUpcomingGroupId  = getNextUpcomingGroupId;
        window.getActivitiesInGroup    = getActivitiesInGroup;
        window.activityAllowsMultiGroup = activityAllowsMultiGroup;
        window.addGroup                = addGroup;
        window.updateGroup             = updateGroup;
        window.deleteGroup             = deleteGroup;
        window.setActivityGroup        = setActivityGroup;
        window.setGroupMembership      = setGroupMembership;
        window.cleanupGroupsForActivity = cleanupGroupsForActivity;

        // ── Recovery / debug helpers ────────────────────────────────────
        // Call from the browser console to nuke all routines and start
        // clean. Useful if duplicates or stale data accumulated before
        // the dedupe-on-read fix landed.
        //   wipeAllGroups()        – delete every group; activities untouched
        //   dedupeGroupsNow()      – force a dedupe pass + save right now
        window.wipeAllGroups = async function() {
            if (!confirm('Delete ALL routines? Your activities will stay in your list — only the routine groupings will be removed.')) return;
            if (window.userData) window.userData.groups = [];
            if (typeof saveUserData === 'function') await saveUserData();
            if (typeof updateDashboard === 'function') updateDashboard();
            if (typeof showToast === 'function') showToast('✓ All routines cleared', 'olive');
        };

        window.dedupeGroupsNow = async function() {
            var before = (window.userData && window.userData.groups) ? window.userData.groups.length : 0;
            _dedupeGroupsArr(window.userData && window.userData.groups);
            var after = (window.userData && window.userData.groups) ? window.userData.groups.length : 0;
            if (after !== before) {
                if (typeof saveUserData === 'function') await saveUserData();
                if (typeof updateDashboard === 'function') updateDashboard();
                if (typeof showToast === 'function') showToast('✓ Merged ' + (before - after) + ' duplicate routine(s)', 'blue');
            } else if (typeof showToast === 'function') {
                showToast('No duplicates found', 'olive');
            }
        };

        // ══════════════════════════════════════════════════════════════════
        // ── Groups — modal UI (create / edit / delete) ─────────────────────
        // ══════════════════════════════════════════════════════════════════

        var _groupModalSelectedActIds = null; // Set, rebuilt on each open

        // Build a themed time <select>. 30-min increments give 48 options,
        // which feels right for routines (no one sets a workout block to
        // start at 7:13). If a legacy value isn't on a half-hour, snap to
        // the nearest tick so the select doesn't blank out.
        function _buildGroupTimeOptions(selectEl, selectedValue) {
            if (!selectEl) return;
            var html = '';
            for (var h = 0; h < 24; h++) {
                for (var m = 0; m < 60; m += 30) {
                    var v = (h < 10 ? '0' : '') + h + ':' + (m === 0 ? '00' : '30');
                    var label = formatTime12(v);
                    html += '<option value="' + v + '">' + label + '</option>';
                }
            }
            selectEl.innerHTML = html;
            if (selectedValue) {
                selectEl.value = selectedValue;
                if (selectEl.value !== selectedValue) {
                    // Snap to nearest 30-min tick.
                    var parts = selectedValue.split(':');
                    var sh = parseInt(parts[0], 10) || 0;
                    var sm = parseInt(parts[1], 10) || 0;
                    var snapped = sm < 15 ? 0 : (sm < 45 ? 30 : 60);
                    if (snapped === 60) { sh = (sh + 1) % 24; snapped = 0; }
                    selectEl.value = (sh < 10 ? '0' : '') + sh + ':' + (snapped === 0 ? '00' : '30');
                }
            }
        }

        // ── Generic info-hint toggler ──────────────────────────────────────
        // Used by small "?" / "i" buttons to reveal short explanatory text
        // for advanced or non-obvious options. Standard pattern across modals.
        // The button must sit inside a container that also contains a
        // sibling element with class `.pl-info-hint`.
        window.toggleInfoHint = function(btn) {
            if (!btn) return;
            // Walk up to the nearest form-field wrapper, then find the hint.
            var field = btn.closest('.pl-field') || btn.parentElement;
            if (!field) return;
            var hint = field.querySelector('.pl-info-hint');
            if (!hint) return;
            var nowHidden = !hint.hasAttribute('hidden');
            if (nowHidden) {
                hint.setAttribute('hidden', '');
                btn.setAttribute('aria-expanded', 'false');
                btn.classList.remove('is-open');
            } else {
                hint.removeAttribute('hidden');
                btn.setAttribute('aria-expanded', 'true');
                btn.classList.add('is-open');
            }
        };

        window.openGroupModal = function(groupId) {
            var modal = document.getElementById('groupModal');
            if (!modal) return;
            _groupModalSelectedActIds = new Set();

            var titleEl    = document.getElementById('groupModalTitle');
            var deleteBtn  = document.getElementById('groupDeleteBtn');
            var editIdEl   = document.getElementById('groupEditingId');
            var nameEl     = document.getElementById('groupName');
            var allDayEl   = document.getElementById('groupAllDay');
            var startEl    = document.getElementById('groupTimeStart');
            var endEl      = document.getElementById('groupTimeEnd');

            var startVal, endVal;
            if (groupId) {
                var g = findGroupById(groupId);
                if (!g) return;
                titleEl.textContent = 'Edit Group';
                editIdEl.value = groupId;
                nameEl.value = g.name || '';
                var allDay = !g.timeStart || !g.timeEnd;
                allDayEl.checked = allDay;
                startVal = g.timeStart || '07:00';
                endVal   = g.timeEnd   || '10:00';
                (g.activityIds || []).forEach(function(id) { _groupModalSelectedActIds.add(id); });
                deleteBtn.style.display = '';
            } else {
                titleEl.textContent = 'New Group';
                editIdEl.value = '';
                nameEl.value = '';
                allDayEl.checked = false;
                // Default time = current ±1h, snapped to nearest 30-min via builder.
                var now = new Date();
                var sH = Math.max(0,  now.getHours() - 1);
                var eH = Math.min(23, now.getHours() + 2);
                startVal = (sH < 10 ? '0' : '') + sH + ':00';
                endVal   = (eH < 10 ? '0' : '') + eH + ':00';
                deleteBtn.style.display = 'none';
            }

            _buildGroupTimeOptions(startEl, startVal);
            _buildGroupTimeOptions(endEl,   endVal);

            toggleGroupAllDay();
            document.getElementById('groupActSearch').value = '';
            renderGroupActPicker();
            updateGroupActCount();
            modal.classList.add('active');
            setTimeout(function() { if (nameEl) nameEl.focus(); }, 100);
        };

        window.closeGroupModal = function() {
            var modal = document.getElementById('groupModal');
            if (modal) modal.classList.remove('active');
            _groupModalSelectedActIds = null;
        };

        window.toggleGroupAllDay = function() {
            var allDay = document.getElementById('groupAllDay').checked;
            document.getElementById('groupTimeRow').style.display = allDay ? 'none' : '';
        };

        window.renderGroupActPicker = function() {
            var list = document.getElementById('groupActList');
            if (!list || !_groupModalSelectedActIds) return;
            var search = (document.getElementById('groupActSearch').value || '').toLowerCase().trim();
            var editingId = document.getElementById('groupEditingId').value || null;

            var allActs = [];
            (window.userData.dimensions || []).forEach(function(dim) {
                (dim.paths || []).forEach(function(path) {
                    (path.activities || []).forEach(function(act) {
                        allActs.push({ id: act.id, name: act.name, dimName: dim.name });
                    });
                });
            });

            if (search) {
                allActs = allActs.filter(function(a) {
                    return (a.name || '').toLowerCase().indexOf(search) !== -1
                        || (a.dimName || '').toLowerCase().indexOf(search) !== -1;
                });
            }

            if (allActs.length === 0) {
                list.innerHTML = '<div class="group-act-list-empty">No activities to show.</div>';
                return;
            }

            list.innerHTML = allActs.map(function(a) {
                var act              = findActivityById(a.id);
                var multi            = activityAllowsMultiGroup(act);
                var otherGroups      = findGroupsForActivity(a.id).filter(function(g) { return g.id !== editingId; });
                var isInThisGroup    = _groupModalSelectedActIds.has(a.id);
                var isInOtherGroup   = otherGroups.length > 0;
                var checked          = isInThisGroup ? 'checked' : '';
                var selCls           = isInThisGroup ? ' selected' : '';
                var meta;
                if (isInOtherGroup) {
                    // For multi-group activities, framed as additive ("also in").
                    // For single-only, framed as a move warning ("in").
                    var label  = otherGroups.map(function(g) { return g.name; }).join(', ');
                    var prefix = multi ? 'also in ' : 'in ';
                    meta = '<span class="group-act-item-already">' + prefix + escapeHtml(label) + '</span>';
                } else {
                    meta = '<span class="group-act-item-meta">' + escapeHtml(a.dimName || '') + '</span>';
                }
                return '<div class="group-act-item' + selCls + '" onclick="toggleGroupAct(\'' + a.id + '\')">'
                    + '<input type="checkbox" ' + checked + '>'
                    + '<span class="group-act-item-name">' + escapeHtml(a.name) + '</span>'
                    + meta
                    + '</div>';
            }).join('');
        };

        window.toggleGroupAct = function(activityId) {
            if (!_groupModalSelectedActIds) return;
            if (_groupModalSelectedActIds.has(activityId)) {
                _groupModalSelectedActIds.delete(activityId);
            } else {
                _groupModalSelectedActIds.add(activityId);
            }
            renderGroupActPicker();
            updateGroupActCount();
        };

        function updateGroupActCount() {
            var el = document.getElementById('groupActCount');
            if (el && _groupModalSelectedActIds) {
                el.textContent = _groupModalSelectedActIds.size + ' selected';
            }
        }

        var _groupSaveInFlight = false;

        window.saveGroupFromModal = async function(event) {
            if (event) event.preventDefault();
            // Hard guard against double-submit. Both an in-memory flag (so a
            // second invocation while the first is awaiting Firestore is a
            // no-op) and a DOM-level disable on the submit button (so the
            // user sees the press registered).
            if (_groupSaveInFlight) return;
            _groupSaveInFlight = true;
            var form = document.getElementById('groupForm');
            var submitBtn = form ? form.querySelector('button[type="submit"]') : null;
            var deleteBtn = document.getElementById('groupDeleteBtn');
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving…'; }
            if (deleteBtn) deleteBtn.disabled = true;

            try {
                var editingId = document.getElementById('groupEditingId').value || null;
                var name = (document.getElementById('groupName').value || '').trim();
                if (!name) return;
                var allDay = document.getElementById('groupAllDay').checked;
                var timeStart = allDay ? null : (document.getElementById('groupTimeStart').value || null);
                var timeEnd   = allDay ? null : (document.getElementById('groupTimeEnd').value   || null);
                var actIds = Array.from(_groupModalSelectedActIds || []);

                if (editingId) {
                    updateGroup(editingId, {
                        name: name, timeStart: timeStart, timeEnd: timeEnd
                    });
                    var prev = (findGroupById(editingId).activityIds || []).slice();
                    prev.forEach(function(id) {
                        if (actIds.indexOf(id) === -1) setGroupMembership(id, editingId, false);
                    });
                    actIds.forEach(function(id) { setGroupMembership(id, editingId, true); });
                } else {
                    var newG = addGroup({
                        name: name, timeStart: timeStart, timeEnd: timeEnd
                    });
                    if (newG) actIds.forEach(function(id) { setGroupMembership(id, newG.id, true); });
                }

                closeGroupModal();
                if (typeof saveUserData === 'function') await saveUserData();
                if (typeof updateDashboard === 'function') updateDashboard();
                if (typeof showToast === 'function') {
                    showToast(editingId ? '✓ Group updated' : '✓ Group created', 'blue');
                }
            } finally {
                _groupSaveInFlight = false;
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save'; }
                if (deleteBtn) deleteBtn.disabled = false;
            }
        };

        window.deleteGroupFromModal = async function() {
            var editingId = document.getElementById('groupEditingId').value || null;
            if (!editingId) return;
            var g = findGroupById(editingId);
            if (!g) return;
            if (!confirm('Delete "' + g.name + '"?\n\nThe activities inside will stay in your list — only the group is removed.')) return;
            // deleteGroup() splices the group out, which inherently drops its
            // activityIds. Activities still in OTHER groups remain there
            // (matters for repeatable multi-group activities).
            deleteGroup(editingId);
            closeGroupModal();
            if (typeof saveUserData === 'function') await saveUserData();
            if (typeof updateDashboard === 'function') updateDashboard();
            if (typeof showToast === 'function') showToast('✓ Group deleted', 'olive');
        };

        // ── Complete / Undo from planner ──
        window.plannerCompleteActivity = function(activityId) {
            completeActivityById(activityId);
            // renderPlanner called via updateDashboard -> renderActivitiesList chain
        };

        window.plannerUndoActivity = function(activityId) {
            undoActivityById(activityId);
        };

        // ── Slot-aware completion (per-slot, not per-activity) ────────────
        // Each planner slot tracks its own completion state. Completing a slot
        // also completes the activity once (so XP/streak fire), but slots for
        // the same activity remain independent — multi-per-day or not.
        window.plannerCompleteSlot = function(slotId, activityId, isRecurring) {
            ensurePlannerData();
            var day = getPlannerDay(window._plannerDate);
            if (isRecurring) {
                if (!day.completedRecurring) day.completedRecurring = {};
                day.completedRecurring[slotId] = true;
            } else {
                (day.items || []).forEach(function(it) {
                    if (it.id === slotId) it.completed = true;
                });
            }
            // Fires XP, streak, toast — same as completing from the activity card.
            // Slot bookkeeping above is already saved by completeActivityById's
            // saveUserData call.
            completeActivityById(activityId);
        };

        window.plannerUndoSlot = function(slotId, activityId, isRecurring) {
            ensurePlannerData();
            var day = getPlannerDay(window._plannerDate);
            if (isRecurring) {
                if (day.completedRecurring) delete day.completedRecurring[slotId];
            } else {
                (day.items || []).forEach(function(it) {
                    if (it.id === slotId) it.completed = false;
                });
            }
            // Reverse the XP/streak side-effect for one completion.
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
            var listEl     = document.getElementById('activitiesListContainer');
            var plannerEl  = document.getElementById('activitiesInlinePlanner');
            var btnEl      = document.getElementById('plannerBtn');
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
            // Two shipped presets. Dark stays first as the safe default for
            // new accounts. Light is the design-brief "parallel light" mode:
            // cool paper background, white cards lifted by shadow (not
            // borders), and a deeper-saturated blue so the interactive
            // primary keeps AA contrast on pale surfaces.
            { id:'default', name:'Dark',  mode:'dark',  bg:'#181818', card:'#242424', accent:'#4472a0', progress:'#537db8' },
            { id:'light',   name:'Light', mode:'light', bg:'#e3e7ee', card:'#fbfcfe', accent:'#2e6fbe', progress:'#3186dd' },
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
            var activeId = saved.presetId || 'default';

            // ── Apply theme mode FIRST so [data-theme-mode="light"] overrides
            //    kick in before colours render. This also runs even when the
            //    settings panel hasn't been opened yet (presets container missing)
            //    so the rest of the app picks up light-mode tokens on cold start.
            var resolvedMode = saved.mode;
            if (!resolvedMode) {
                var matched = THEMES.find(function(x){ return x.id === activeId; });
                resolvedMode = (matched && matched.mode) ? matched.mode : 'dark';
            }
            _applyThemeMode(resolvedMode);

            // ── Migration: retired presets ────────────────────────────────
            // Earlier builds shipped extra presets (Paper, Midnight, Mint,
            // Forest, …) that have since been removed. Accounts still saved
            // on one of them fall back to the surviving preset of the same
            // mode, colours included, so nobody is left stranded on a
            // palette the picker can no longer show.
            var knownPreset = activeId === 'custom'
                || THEMES.some(function(t){ return t.id === activeId; });
            if (!knownPreset) {
                var fallback = THEMES.find(function(t){ return t.mode === resolvedMode; }) || THEMES[0];
                activeId = fallback.id;
                saved = { presetId: fallback.id, mode: fallback.mode,
                    bg: fallback.bg, card: fallback.card,
                    secondary: adjustColor(fallback.bg, fallback.mode === 'light' ? -8 : 20),
                    accent: fallback.accent, progress: fallback.progress };
                // Seed the pending state so "Apply Theme" persists the
                // migrated preset even if the user never taps a swatch.
                window._pendingTheme = JSON.parse(JSON.stringify(saved));
            }

            // ── Presets are living values ─────────────────────────────────
            // A saved preset stores a snapshot of its colours, but presets
            // get retuned (the Light palette had a full design pass after
            // launch). Anyone on a named preset always gets the preset's
            // CURRENT colours; stored snapshots only bind custom themes.
            var presetMatch = THEMES.find(function(t){ return t.id === activeId; });
            if (presetMatch) {
                saved = Object.assign({}, saved, {
                    mode: presetMatch.mode,
                    bg: presetMatch.bg,
                    card: presetMatch.card,
                    secondary: adjustColor(presetMatch.bg, presetMatch.mode === 'light' ? -8 : 20),
                    accent: presetMatch.accent,
                    progress: presetMatch.progress
                });
            }

            if (!presets) return;

            // Build preset swatches — both shipped presets are selectable.
            var swatchHtml = '';
            THEMES.forEach(function(t) {
                // Pick a swatch-dot border that's visible against both light and dark
                // backgrounds: dark themes get a soft mid-grey, light themes get a
                // darker grey so the white card swatch doesn't blend into the panel.
                var dotBorder = (t.mode === 'light') ? '#c4c4c4' : '#444';
                swatchHtml += '<div class="theme-swatch' + (t.id === activeId ? ' active' : '') + '"'
                    + ' onclick="applyThemePreset(\'' + t.id + '\', this)">'
                    + '<div class="theme-swatch-colors">'
                    + '<div class="theme-swatch-dot" style="background:' + t.bg + ';border:1px solid ' + dotBorder + ';"></div>'
                    + '<div class="theme-swatch-dot" style="background:' + t.accent + ';"></div>'
                    + '<div class="theme-swatch-dot" style="background:' + t.progress + ';"></div>'
                    + '</div>'
                    + '<span class="theme-swatch-name">' + t.name + '</span>'
                    + '</div>';
            });
            // Custom stays visible as an option but ships locked — it only
            // unlocks for accounts that already had a custom theme active
            // before the lock (migration grace).
            var customActive = activeId === 'custom';
            var customUnlocked = customActive;
            var customClickAttr = customUnlocked
                ? ' onclick="activateCustomTheme(this)"'
                : ' onclick="event.preventDefault();" aria-disabled="true" title="Custom themes — coming soon"';
            var customLockedCls = customUnlocked ? '' : ' theme-swatch-locked';
            swatchHtml += '<div class="theme-swatch' + (customActive ? ' active' : '') + customLockedCls + '" id="customSwatch"' + customClickAttr + '>'
                + '<div class="theme-swatch-colors">'
                + '<div class="theme-swatch-dot" style="background:conic-gradient(#e84545,#f7b731,#2ecc71,#4a7c9e,#9b59b6,#e84545);border:none;"></div>'
                + '</div>'
                + '<span class="theme-swatch-name">Custom</span>'
                + (customUnlocked ? '' : '<span class="theme-swatch-lock" aria-hidden="true">'
                    + '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">'
                    + '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>'
                    + '<path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>')
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
            // Custom themes use dark-tinted surfaces by default — flip mode back to dark
            // so the [data-theme-mode="light"] overrides don't interfere with the user's
            // custom palette. Users who want a light custom palette can edit colours freely.
            _applyThemeMode('dark');
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

        // ── Helper: set the html[data-theme-mode] attribute so light overrides kick in
        function _applyThemeMode(mode) {
            var m = (mode === 'light') ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme-mode', m);
            // Keep the browser/PWA chrome (status bar, title bar) in step
            var meta = document.querySelector('meta[name="theme-color"]');
            if (meta) meta.setAttribute('content', m === 'light' ? '#e3e7ee' : '#1a1a1a');
        }

        window.applyThemePreset = function(id, el) {
            var t = THEMES.find(function(x){return x.id===id;});
            if (!t) return;
            // CRITICAL: REMOVE inline overrides instead of setting them to dark
            // defaults. Inline styles beat the [data-theme-mode="light"] cascade,
            // so re-inlining the dark default colours makes light themes render
            // white-on-white text. Removing the inline overrides lets the
            // cascade (root → light override) compute the right value per mode.
            CUSTOM_COLOR_VARS.forEach(function(v) {
                document.documentElement.style.removeProperty(v.variable);
            });
            // Also clear any custom glow vars from a previous custom theme so
            // they don't bleed into a preset.
            document.documentElement.style.removeProperty('--color-bg-glow-a');
            document.documentElement.style.removeProperty('--color-bg-glow-m');
            document.documentElement.style.removeProperty('--color-bg-glow-b');
            // Toggle light/dark mode BEFORE setting colours so the [data-theme-mode]
            // overrides apply cleanly on top of the preset's bg/card/accent values.
            _applyThemeMode(t.mode);
            document.documentElement.style.setProperty('--color-bg-primary',   t.bg);
            document.documentElement.style.setProperty('--color-bg-secondary', adjustColor(t.bg, t.mode === 'light' ? -8 : 20));
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
            window._pendingTheme = { presetId: id, mode: t.mode, bg: t.bg, card: t.card,
                secondary: adjustColor(t.bg, t.mode === 'light' ? -8 : 20), accent: t.accent, progress: t.progress };
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
                pending.mode = 'dark'; // custom themes assume dark-tinted surfaces
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
                // Ensure mode is captured for presets even if older code paths left it empty
                if (!pending.mode) {
                    var t = THEMES.find(function(x){ return x.id === pending.presetId; });
                    pending.mode = (t && t.mode) ? t.mode : 'dark';
                }
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
        // ALGORITHM — forward walk from streakStartWindow through closed windows:
        //   Hit  → streak++
        //   Miss → if shields remain: consume one and continue
        //          else: break (unshielded miss = streak is over, reset to 0)
        //
        // "Closed" means the window ended before today's window started.
        // Today's open window is handled exclusively by completeActivity
        // (streak +1 via streakGrantedDate guard). Undo reverses that +1.
        //
        // The walk is the SINGLE SOURCE OF TRUTH for past windows. It re-derives
        // streak and shieldsConsumed from completionHistory on every login.
        // With no streakStartWindow anchor, there is no current streak to verify
        // and streak stays 0 — completeActivity restamps the anchor on the next
        // 0→1 transition.
        //
        // SHIELD RULES:
        //   3 base shields per streak; +1 at each milestone (25/50/75/100), cap 7.
        //   Each missed closed window costs 1 shield. Unshielded miss → streak=0.
        //   Shields reset to 3 automatically when a new streak begins (the walk
        //   finds no consumed shields in a fresh run).
        //   completeActivity and undoActivity NEVER touch shieldsConsumed.
        //
        // Returns true if any field was mutated (caller saves to Firestore).
        // ══════════════════════════════════════════════════════════════════
        function processStreakSystem(activity, today) {
            // No streak mechanics for these types
            if (activity.frequency === 'occasional') return false;
            if (activity.isNegative && !activity.isSkipNegative) return false;

            // Idempotency: only run once per calendar day per activity
            if (activity.lastProcessedDate === today) return false;
            activity.lastProcessedDate = today;

            // Nothing to compute yet
            if (!activity.lastCompleted) return true;

            // ── Today's window ────────────────────────────────────────────
            const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
            const todayWindow = getCycleWindowStart(activity, todayMidnight);
            if (!todayWindow) return true;

            // ── Walk anchor: streakStartWindow ────────────────────────────
            // Stamped by completeActivity on every 0→1 streak transition. For
            // activities carrying an active streak from a code version where
            // the field didn't exist yet, derive it inline: walk backwards
            // from lastCompleted, shields covering missed windows, until an
            // unshielded break. The oldest hit found is the streak start.
            // The result is written back to streakStartWindow so subsequent
            // logins use it directly. New users never enter this branch —
            // their streak is 0 until completeActivity stamps the anchor.
            let streakStartFloor = activity.streakStartWindow
                ? (getCycleWindowStart(activity, new Date(activity.streakStartWindow + 'T00:00:00'))
                   || new Date(activity.streakStartWindow + 'T00:00:00'))
                : null;

            if (!streakStartFloor && (activity.streak || 0) > 0) {
                const lcWindow = getCycleWindowStart(activity, new Date(activity.lastCompleted));
                if (lcWindow) {
                    const healHist = (activity.completionHistory || [])
                        .filter(e => !e.isPenalty && (e.xp || 0) > 0);
                    let cur = lcWindow, shieldsLeft = BASE_SHIELDS, oldestHit = lcWindow;
                    for (let i = 0; i < 400; i++) {
                        const winEnd = getNextCycleWindowStart(activity, cur);
                        if (!winEnd) break;
                        const cs = cur.getTime(), ce = winEnd.getTime();
                        const hit = healHist.some(e => {
                            const t = new Date(e.date).getTime();
                            return t >= cs && t < ce;
                        });
                        if (hit) oldestHit = cur;
                        else if (shieldsLeft > 0) shieldsLeft--;
                        else break;
                        const prev = getCycleWindowStart(activity, new Date(cur.getTime() - 1));
                        if (!prev) break;
                        cur = prev;
                    }
                    streakStartFloor = oldestHit;
                    activity.streakStartWindow = toLocalDateStr(oldestHit);
                }
            }

            let streak = 0;
            let shieldsConsumed = 0;
            let walkCapUsed = BASE_SHIELDS;
            let streakStartWindow = null;
            const MAX_WALK = 400;

            if (streakStartFloor) {
                // Real completions only (no XP-penalty entries), sorted ascending.
                const history = (activity.completionHistory || [])
                    .filter(e => !e.isPenalty && (e.xp || 0) > 0)
                    .sort((a, b) => new Date(a.date) - new Date(b.date));

                // Forward walk through closed windows. Shields are consumed in
                // the order misses actually occurred, matching the user's mental
                // model ("I missed day 3 so a shield was used; missed day 8 so
                // the streak broke").
                let fwdCursor = streakStartFloor;
                for (let i = 0; i < MAX_WALK; i++) {
                    if (!fwdCursor || fwdCursor.getTime() >= todayWindow.getTime()) break;
                    const nextWin = getNextCycleWindowStart(activity, fwdCursor);
                    if (!nextWin) break;
                    const cStart = fwdCursor.getTime(), cEnd = nextWin.getTime();
                    const hit = history.some(e => {
                        const t = new Date(e.date).getTime();
                        return t >= cStart && t < cEnd;
                    });
                    if (hit) {
                        streak++;
                        if (!streakStartWindow) streakStartWindow = fwdCursor;
                        if (SHIELD_MILESTONES.includes(streak))
                            walkCapUsed = Math.min(SHIELD_ABS_CAP, walkCapUsed + 1);
                    } else if (streak > 0 && (walkCapUsed - shieldsConsumed) > 0) {
                        shieldsConsumed++;
                    } else if (streak > 0) {
                        // Unshielded miss — streak breaks. Reset so any later
                        // segment in the same walk starts fresh with full shields.
                        streak = 0; shieldsConsumed = 0; walkCapUsed = BASE_SHIELDS;
                        streakStartWindow = null;
                    }
                    // streak===0 + miss: no active streak to protect, skip.
                    fwdCursor = nextWin;
                }
            }

            const finalStreak = streak;

            // ── Open-window protection for non-daily frequencies ──────────
            // The walk only checks CLOSED windows. For weekly/biweekly/monthly
            // activities the current open window can last 7–30 days. If the
            // streak started in THIS week/month and processStreakSystem fires
            // on a subsequent day within the same window, the walk has no
            // closed windows yet to verify and would wipe a valid streak.
            // Leave it alone — completeActivity already owns this window.
            if (finalStreak === 0 && (activity.streak || 0) > 0 && activity.streakStartWindow) {
                const swDate = new Date(activity.streakStartWindow + 'T00:00:00');
                const swWindow = getCycleWindowStart(activity, swDate);
                if (swWindow && swWindow.getTime() === todayWindow.getTime()) {
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
                // Always re-stamp from the walk — handles mid-walk resets where
                // an earlier segment broke and a later one anchored elsewhere.
                activity.streakStartWindow = streakStartWindow
                    ? toLocalDateStr(streakStartWindow)
                    : activity.streakStartWindow;
                activity.shieldCapUsed = walkCapUsed;
            }

            return true;
        }

        // ── processStreakPauses ───────────────────────────────────────────
        // Entry point called at login. Runs streak+shield system and XP
        // penalties for all activities, then persists any changes in one write.
        async function processStreakPauses() {
            const today = toLocalDateStr(new Date());
            let anyChanged = false;
            (window.userData.dimensions || []).forEach(dim =>
                (dim.paths || []).forEach(path =>
                    (path.activities || []).forEach(act => {
                        if (processStreakSystem(act, today)) anyChanged = true;
                        if (processSkipPenalty(act, today))  anyChanged = true;
                    })));
            // Tech Tree mastery rides the same recompute pass (spec §3/§14).
            if (typeof evaluateTechTreeMastery === 'function' && evaluateTechTreeMastery()) anyChanged = true;
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
        // Self-contained owner of the skip-negative XP penalty system.
        //   - Walks closed windows after skipPenaltyWindow up to today.
        //   - Charges baseXP × min(missed, 7) — flat, no compounding.
        //   - Advances skipPenaltyWindow to the most-recent closed window
        //     regardless of cap, so the next login starts from "now", not
        //     from "now minus the cap" (which would re-charge already-paid windows).
        //   - Idempotent per day via lastSkipCheckDate.
        //
        // INDEPENDENCE: reads only the activity's own completionHistory and
        // shared date helpers (getCycleWindowStart / getNextCycleWindowStart /
        // toLocalDateStr). Writes only to penalty-owned fields. Never touches
        // streak, shields, or anything processStreakSystem reads or writes.
        //
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

            // Resolve the penalty anchor BEFORE stamping lastSkipCheckDate,
            // because _getSkipPenaltyWindow falls back to lastSkipCheckDate
            // for legacy activities. Stamping first would make that fallback
            // resolve to today → 0 missed windows.
            const penaltyAnchor = _getSkipPenaltyWindow(activity);
            activity.lastSkipCheckDate = today;
            if (!penaltyAnchor) {
                activity.skipPenaltyWindow = toLocalDateStr(
                    getCycleWindowStart(activity, new Date()) || new Date()
                );
                return true;
            }

            // ── Walk closed windows after the anchor, up to today ─────────
            const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
            const todayWindow   = getCycleWindowStart(activity, todayMidnight);
            const anchorWindow  = getCycleWindowStart(activity, new Date(penaltyAnchor + 'T00:00:00'));
            if (!todayWindow || !anchorWindow) return true;

            let cursor = getNextCycleWindowStart(activity, anchorWindow);
            if (!cursor || cursor.getTime() >= todayWindow.getTime()) return true;

            const realHistory = (activity.completionHistory || []).filter(
                e => !e.isPenalty && (e.xp || 0) > 0
            );

            let missedCount = 0;
            let lastClosedWindowStr = penaltyAnchor;
            const MAX_WALK = 400;
            for (let i = 0; i < MAX_WALK && cursor.getTime() < todayWindow.getTime(); i++) {
                const next = getNextCycleWindowStart(activity, cursor);
                if (!next) break;
                const cs = cursor.getTime(), ce = next.getTime();
                const hit = realHistory.some(e => {
                    const t = new Date(e.date).getTime();
                    return t >= cs && t < ce;
                });
                if (!hit) missedCount++;
                lastClosedWindowStr = toLocalDateStr(cursor);
                cursor = next;
            }

            // Always advance the stamp past every window we walked, even if we
            // cap the charge below. This is the key to preventing re-charges
            // on subsequent logins.
            if (lastClosedWindowStr !== penaltyAnchor) {
                activity.skipPenaltyWindow = lastClosedWindowStr;
            }
            if (missedCount === 0) return true;

            const missedCharged = Math.min(7, missedCount);
            activity.skipStreak = (activity.skipStreak || 0) + missedCharged;

            const penaltyPerWindow = activity.baseXP || 10;
            const totalPenalty     = penaltyPerWindow * missedCharged;
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
            activity.lastPenaltyDays = missedCharged;
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
                dimensions: [], activities: [], challenges: [], quests: [], rewards: {},
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
                    largeAvatar.innerHTML = `<img src="${escapeHtml(user.photoURL)}" alt="">`;
                    largeAvatar.style.background = '';
                } else {
                    largeAvatar.innerHTML = '';
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

            // ── Level bar (new card-2 hero progress) ──────────────────────
            const level = data.level || 1;
            const isMax = level >= 100;
            const xpNeeded = isMax ? 0 : calculateXPForLevel(level);
            const xpCurrent = data.currentXP || 0;
            const pct = isMax ? 100 : xpNeeded > 0 ? Math.min(100, (xpCurrent / xpNeeded) * 100) : 0;

            const levelNum  = document.getElementById('profileLevelNum');
            const xpToNext  = document.getElementById('profileXpToNext');
            const levelBar  = document.getElementById('profileLevelBar');
            const xpLbl     = document.getElementById('profileXpLabel');

            if (levelNum) levelNum.textContent = String(level);
            if (xpLbl)    xpLbl.textContent    = isMax ? 'MAX' : `${xpCurrent.toLocaleString()} / ${xpNeeded.toLocaleString()} XP`;
            if (xpToNext) xpToNext.textContent = isMax ? '★ Max level' : `${Math.max(0, xpNeeded - xpCurrent).toLocaleString()} to next`;
            if (levelBar) levelBar.style.width  = pct.toFixed(1) + '%';

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
                    { val: totalXP.toLocaleString(),    lbl: 'Total XP' },
                    { val: totalComps.toLocaleString(), lbl: 'Completions' },
                    { val: bestStreak,                  lbl: 'Best Streak' },
                    { val: activeDays,                  lbl: 'Active Days' },
                    { val: actCount,                    lbl: 'Activities' },
                    { val: dimCount,                    lbl: 'Dimensions' },
                ];
                statsGrid.innerHTML = tiles.map(t => `
                    <div class="pf-stat-tile">
                        <div class="pf-stat-val">${t.val}</div>
                        <div class="pf-stat-lbl">${t.lbl}</div>
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
            const legendEl  = document.getElementById('profileSpiderLegend');
            if (!container) return;
            renderSpiderChartCanvas(container, legendEl, getProfileCategoryXP(), {
                emptyTitle: 'No category data yet',
                emptyHint: 'Use "Configure Life Categories" below to assign activities to life areas.',
                retryFn: function() { renderProfileSpiderChart(); }
            });
        }

        // Generic spider chart renderer — used by user profile and friend profile.
        // catXP is { categoryId → xp }. opts may set emptyTitle/emptyHint/retryFn.
        function renderSpiderChartCanvas(container, legendEl, catXP, opts) {
            opts = opts || {};
            const cats = window.LIFE_CATEGORIES;
            const filledCount = cats.filter(c => (catXP[c.id] || 0) > 0).length;

            if (filledCount < 1) {
                container.innerHTML =
                    '<div class="pf-spider-empty">' +
                        '<div class="pf-spider-empty-icon">🕸️</div>' +
                        '<div class="pf-spider-empty-title">' + escapeHtml(opts.emptyTitle || 'No category data yet') + '</div>' +
                        '<div>' + escapeHtml(opts.emptyHint || 'No activities have been tagged into life categories yet.') + '</div>' +
                    '</div>';
                if (legendEl) legendEl.innerHTML = '';
                return;
            }

            const totalCatXP = Object.values(catXP).reduce((s, v) => s + (v || 0), 0);

            const DPR = window.devicePixelRatio || 1;
            const rawSize = container.clientWidth || container.offsetWidth || 0;
            if (rawSize === 0) {
                if (opts.retryFn) setTimeout(function() { try { opts.retryFn(); } catch(e) {} }, 300);
                return;
            }
            const SIZE = Math.min(rawSize, 340);

            let canvas = container.querySelector('canvas.pf-spider-canvas');
            if (!canvas) {
                canvas = document.createElement('canvas');
                canvas.className = 'pf-spider-canvas';
                canvas.style.cssText = 'display:block;width:100%;max-width:340px;margin:0 auto;';
                container.innerHTML = '';
                container.appendChild(canvas);
            }
            canvas.width  = SIZE * DPR;
            canvas.height = SIZE * DPR;
            const ctx = canvas.getContext('2d');
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.scale(DPR, DPR);

            const cx = SIZE / 2, cy = SIZE / 2;
            const R  = SIZE * 0.36;
            const N  = cats.length;
            const angle = i => (Math.PI * 2 * i / N) - Math.PI / 2;

            const BASE_FRAC = 0.4;
            const FLOOR_FRAC = 0.05;
            const spiderR = (xp) => {
                if (xp <= 0) return R * FLOOR_FRAC;
                return R * (BASE_FRAC + (1 - BASE_FRAC) * (xp / totalCatXP));
            };

            const root = getComputedStyle(document.documentElement);
            const textSec = root.getPropertyValue('--color-text-secondary').trim() || '#b0b0b0';
            const borderColor = root.getPropertyValue('--color-border').trim() || '#3a3a3a';
            const isLight = document.documentElement.getAttribute('data-theme-mode') === 'light';

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
                ctx.strokeStyle = isLight
                    ? `rgba(15,17,21,${frac === 1 ? 0.10 : 0.05})`
                    : `rgba(255,255,255,${frac === 1 ? 0.10 : 0.05})`;
                ctx.lineWidth = 0.8;
                ctx.stroke();
            });

            // Spokes
            cats.forEach((_, i) => {
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(cx + R * Math.cos(angle(i)), cy + R * Math.sin(angle(i)));
                ctx.strokeStyle = isLight ? 'rgba(15,17,21,0.07)' : 'rgba(255,255,255,0.07)';
                ctx.lineWidth = 0.8;
                ctx.stroke();
            });

            // Fill polygon
            ctx.beginPath();
            cats.forEach((c, i) => {
                const r = spiderR(catXP[c.id] || 0);
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
            cats.forEach((c, i) => {
                const xp = catXP[c.id] || 0;
                if (xp <= 0) return;
                const r = spiderR(xp);
                const x = cx + r * Math.cos(angle(i));
                const y = cy + r * Math.sin(angle(i));
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fillStyle = c.color;
                ctx.fill();
            });

            // Axis labels
            cats.forEach((c, i) => {
                const xp = catXP[c.id] || 0;
                const labelR = R + 22;
                const x = cx + labelR * Math.cos(angle(i));
                const y = cy + labelR * Math.sin(angle(i));
                ctx.font = `bold ${SIZE < 260 ? 9 : 10}px Inter, sans-serif`;
                ctx.fillStyle = xp > 0 ? c.color : textSec;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`${c.emoji} ${c.label}`, x, y);
            });

            // XP label at each data point
            cats.forEach((c, i) => {
                const xp = catXP[c.id] || 0;
                if (xp <= 0) return;
                const r = spiderR(xp);
                const x = cx + r * Math.cos(angle(i));
                const y = cy + r * Math.sin(angle(i));
                ctx.font = `600 9px Inter, sans-serif`;
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
                    const xp = catXP[c.id] || 0;
                    const pct = totalCatXP > 0 ? Math.round(xp / totalCatXP * 100) : 0;
                    const isOn = xp > 0;
                    return `<span class="pf-spider-legend-item" style="color:${isOn ? c.color : textSec};opacity:${isOn ? 1 : 0.45};">
                        <span class="pf-spider-legend-dot" style="background:${isOn ? c.color : borderColor};"></span>
                        ${c.emoji} ${c.label}
                        ${isOn ? `<span class="pf-spider-legend-num">· ${xp.toLocaleString()} XP · ${pct}%</span>` : `<span class="pf-spider-legend-num">· no data</span>`}
                    </span>`;
                }).join('');
            }
        }

        // ── Spider Config ─────────────────────────────────────────────────
        window.toggleSpiderConfig = function() {
            const body = document.getElementById('spiderConfigBody');
            const btn  = document.getElementById('spiderConfigToggleBtn');
            if (!body) return;
            const isOpen = body.style.display === 'none';
            body.style.display = isOpen ? 'block' : 'none';
            if (btn) btn.classList.toggle('open', isOpen);
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

                html += `<div class="pf-cfg-dim-header">${escapeHtml(dim.name)}</div>`;

                acts.forEach(act => {
                    const currentTag = tags[act.id] || '';
                    const pillsHtml = window.LIFE_CATEGORIES.map(c => {
                        const isActive = currentTag === c.id;
                        const rgb = _hexToRgbStr(c.color);
                        const activeStyle = isActive
                            ? `background:${c.color};border-color:${c.color};color:#fff;`
                            : `background:rgba(${rgb},0.08);border-color:rgba(${rgb},0.22);color:${c.color};`;
                        return `<button class="pf-cfg-pill${isActive ? ' active' : ''}"
                            style="${activeStyle}"
                            onclick="setSpiderTag('${escapeHtml(act.id)}','${isActive ? '' : c.id}')">${c.emoji} ${c.label}</button>`;
                    }).join('');

                    html += `<div class="pf-cfg-row">
                        <div class="pf-cfg-name">${escapeHtml(act.name)}</div>
                        <div class="pf-cfg-pills">${pillsHtml}</div>
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

        // ── Toast notifications ───────────────────────────────────────────
        // Visual recipe matches the design brief: card material (#22242a +
        // hairline + inset top highlight + drop shadow stack). The color
        // tag is conveyed by a 3px left-edge stripe (same family as
        // dimension cards) — NOT by a flooded background. Each toast also
        // gets a tiny SVG glyph matching its color role. Toasts stack
        // bottom-up on top of each other (newest at top).
        const TOAST_CONFIG = {
            blue:  { stripe: 'var(--color-progress)',
                     icon:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>' },
            green: { stripe: 'var(--chip-xp-fg)',
                     icon:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' },
            olive: { stripe: 'var(--chip-streak-fg)',
                     icon:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' },
            red:   { stripe: 'var(--color-accent-red)',
                     icon:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' },
        };

        function _ensureToastStack() {
            let stack = document.getElementById('mkToastStack');
            if (!stack) {
                stack = document.createElement('div');
                stack.id = 'mkToastStack';
                stack.className = 'mk-toast-stack';
                document.body.appendChild(stack);
            }
            return stack;
        }

        function showToast(message, color = 'blue') {
            const cfg = TOAST_CONFIG[color] || TOAST_CONFIG.blue;
            const stack = _ensureToastStack();
            const toast = document.createElement('div');
            toast.className = 'mk-toast mk-toast-' + color;
            toast.style.setProperty('--mk-toast-stripe', cfg.stripe);
            // Newer toasts insert at the top of the stack so the most-
            // recent message reads first.
            toast.innerHTML =
                '<span class="mk-toast-icon">' + cfg.icon + '</span>' +
                '<span class="mk-toast-msg"></span>';
            // Set message via textContent to avoid XSS from caller-supplied
            // strings (some sites pass user-content into toasts).
            toast.querySelector('.mk-toast-msg').textContent = message;
            stack.insertBefore(toast, stack.firstChild);
            // Trigger enter animation on next frame so the transition runs
            requestAnimationFrame(() => toast.classList.add('mk-toast-in'));
            // Auto-dismiss
            setTimeout(() => {
                toast.classList.remove('mk-toast-in');
                toast.classList.add('mk-toast-out');
                setTimeout(() => toast.remove(), 260);
            }, 3200);
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

        // After Inter has fully loaded, force a one-shot resize of the
        // level number SVG. The first updateDashboard runs before fonts
        // are committed, so getComputedTextLength returns a fallback-font
        // measurement and the SVG ends up slightly mis-sized.
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function() {
                try {
                    var fillEl = document.getElementById('currentLevel');
                    var svgEl = document.getElementById('levelSvg');
                    var traceEl = document.getElementById('currentLevelTrace');
                    if (fillEl && svgEl) {
                        var len = fillEl.getComputedTextLength();
                        if (len > 0) svgEl.setAttribute('width', Math.ceil(len) + 4);
                    }
                    // Arm the trace animation now that fonts are settled
                    // and the SVG has its final width.
                    if (traceEl) traceEl.classList.add('trace-ready');
                } catch (e) { /* non-critical */ }
            });
        }

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
            // If the inline in-app-browser detector (in index.html) already took
            // over the screen, don't render the normal landing on top of it.
            if (window._mkInAppBrowser) {
                const authContainer = document.getElementById('authContainer');
                if (authContainer) authContainer.style.display = 'none';
                return;
            }

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
            obRenderSlide(0); // handles slide 0 animations + XP fill + lv tick
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
                        // Restart descendant animations too — the mock cards,
                        // XP row, tier cards, streak chip and shields all rely
                        // on staggered keyframes that would otherwise be frozen
                        // at their end-state when re-displayed.
                        s.querySelectorAll(
                            '.ob-mock-act-card, .ob-mock-ring-arc, .ob-mock-ring-check, ' +
                            '.ob-mock-xp-chip, .ob-mock-xp-row, .ob-mock-lv-next, ' +
                            '.ob-mock-tier, .ob-mock-streak-chip, .ob-mock-streak-chip svg'
                        ).forEach(el => {
                            el.style.animation = 'none';
                            void el.offsetWidth;
                            el.style.animation = '';
                        });
                        // Reset XP fill width so it re-animates from 0 → 72%
                        // on each visit to slide 0.
                        if (n === 0) {
                            const fill = s.querySelector('#obXpFill');
                            if (fill) {
                                fill.style.transition = 'none';
                                fill.style.width = '0%';
                                void fill.offsetWidth;
                                fill.style.transition = '';
                                setTimeout(() => { fill.style.width = '72%'; }, 50);
                            }
                            const lvEl = s.querySelector('#obLvNum');
                            if (lvEl) {
                                lvEl.textContent = '1';
                                setTimeout(() => { lvEl.textContent = '2'; }, 1900);
                            }
                        }
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
            if (nextBtn) nextBtn.textContent = n === OB_TOTAL_SLIDES - 1 ? "Let's go" : 'Next';
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
            if (window.switchTab) switchTab('activities');
            // Build-My-Own users have no activities yet, so we skip the
            // activity-card step and only show the XP bar + the + button.
            // When the tour finishes, fire the polished tutorial card.
            setTimeout(() => {
                if (typeof window.runOnboardingTour === 'function') {
                    window.runOnboardingTour({
                        stepIds: ['xp', 'add'],
                        onComplete: () => initTutorial()
                    });
                } else {
                    initTutorial();
                }
            }, 500);
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
            btn.textContent = n === 0 ? 'Pick at least one' : 'Next';
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
                btn.textContent = n === 0 ? 'Pick at least one' : `Add ${n} activit${n === 1 ? 'y' : 'ies'}`;
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
                showToast('🎉 Your space is ready!', 'blue');
                if (window.switchTab) switchTab('activities');
                // Mark the create-first-activity tutorial step as complete since the
                // user already has activities. Tab unlock spotlights will fire later.
                window.userData.tutorialStep = 99; // done
                saveUserData().catch(() => {});
                updateDashboard();
                // Walk the user through the live Activities tab. The
                // 'add' step (highlighting the + button and inviting more
                // activities) is dropped when the user already filled
                // every available slot — pushing them to add a 5th when
                // the cap is 4 just trains learned helplessness. Next
                // login, after a level-up, the seat will be open and the
                // toast in updateDashboard reminds them.
                const canAddMore = typeof canAddActivity === 'function' ? canAddActivity() : true;
                const tourSteps = canAddMore ? ['xp', 'card', 'add'] : ['xp', 'card'];
                setTimeout(() => {
                    if (typeof window.runOnboardingTour === 'function') {
                        window.runOnboardingTour({ stepIds: tourSteps });
                    }
                }, 600);
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
                eyebrow: 'YOUR FIRST ACTIVITY',
                emoji: '🎯',
                title: 'One habit. One tap.',
                body: 'Activities are the habits you want to track. Walk, read, sleep — whatever moves the needle for <strong>you</strong>. Tap below to make your first one.',
                preview: [
                    { kind: 'xp',     icon: 'bolt',  label: 'Earn XP' },
                    { kind: 'streak', icon: 'flame', label: 'Build streaks' },
                    { kind: 'level',  icon: 'star',  label: 'Level up' },
                ],
                cta: 'Create activity',
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
                <div class="spotlight-eyebrow">NEW TAB UNLOCKED</div>
                <div class="spotlight-emoji">${meta.emoji}</div>
                <h3 class="spotlight-title">${escapeHtml(meta.label)} is live</h3>
                <p class="spotlight-body">${escapeHtml(meta.body)}</p>
                <div class="spotlight-card-actions">
                    <button class="spotlight-cta" onclick="dismissTabUnlockSpotlight()">Got it</button>
                </div>
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

        // ══════════════════════════════════════════════════════════════════
        // POST-PICKER ONBOARDING TOUR
        // ─────────────────────────────────────────────────────────────────
        // After the user finishes the picker (or chooses Build-My-Own), we
        // walk them through the live Activities tab — pointing out the XP
        // bar/level, an activity card (if any exist), and the + button. The
        // tour uses the same spotlight DOM (#spotlightOverlay/#spotlightCutout
        // /#spotlightCard) as the tab-unlock spotlights, but driven by a
        // step config array instead of the TAB_UNLOCKS map. Each step:
        //
        //   selector     CSS selector(s) to find the target element. The
        //                first match found is highlighted. Multiple
        //                selectors (comma-separated) lets us bundle related
        //                elements (e.g. the level badge + XP bar together).
        //   bundle       If true, the bounding rect spans ALL matched
        //                elements (used for the XP+Level pairing).
        //   skipIfMissing If true, skip the step when no element matches
        //                (used for the activity-card step in Build-My-Own,
        //                where the user has no activities yet).
        //   eyebrow/emoji/title/body/cta  Content for the spotlight card.
        // ══════════════════════════════════════════════════════════════════

        const OB_TOUR_STEPS = [
            {
                id: 'xp',
                selector: '.level-badge, .progress-section',
                bundle: true,
                pad: 8,
                radius: 12,
                eyebrow: 'YOUR PROGRESS',
                emoji: '⚡',
                title: 'This is your XP',
                body: 'Every habit you complete adds XP here. Fill the bar to level up — that\'s the whole game.',
                cta: 'Got it',
            },
            {
                id: 'card',
                selector: '.activity-item',
                pad: 6,
                radius: 14,
                skipIfMissing: true,
                eyebrow: 'LOG A HABIT',
                emoji: '👆',
                title: 'Tap to log it',
                body: 'One tap marks a habit done and lands the XP. Long-press or swipe for more options later.',
                cta: 'Next',
            },
            {
                id: 'add',
                selector: '.act-tb-add-main',
                pad: 8,
                radius: 100,
                eyebrow: 'BUILD YOUR LIST',
                emoji: '✨',
                title: 'Add more anytime',
                body: 'Hit this any time you think of a new habit. Group them into Paths and Dimensions later — when it makes sense.',
                cta: 'Start tracking',
            },
        ];

        // Tour runtime state — module-scoped (not on window) so external
        // code can\'t accidentally fast-forward.
        let _obTourQueue = [];
        let _obTourIdx = 0;
        let _obTourOnComplete = null;

        function _obTourFindTarget(step) {
            // Filter out elements that aren\'t laid out (display:none, in a
            // hidden sub-tab, etc.). offsetParent is null when an ancestor
            // has display:none — exactly the case we need to skip when
            // multiple sub-tabs share the same class (.act-tb-add-main
            // exists in activities, dimensions and challenges sub-tabs).
            const els = Array.from(document.querySelectorAll(step.selector))
                .filter(el => el.offsetParent !== null || el.getClientRects().length > 0);
            return els.length ? els : null;
        }

        function _obTourComputeRect(els, bundle) {
            if (!bundle || els.length === 1) {
                return els[0].getBoundingClientRect();
            }
            // Bundle multiple targets into one bounding rect
            let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
            els.forEach(el => {
                const r = el.getBoundingClientRect();
                minL = Math.min(minL, r.left);
                minT = Math.min(minT, r.top);
                maxR = Math.max(maxR, r.right);
                maxB = Math.max(maxB, r.bottom);
            });
            return { left: minL, top: minT, right: maxR, bottom: maxB,
                     width: maxR - minL, height: maxB - minT };
        }

        function _obTourRender() {
            // Skip steps whose targets aren\'t found (if skipIfMissing) or
            // bail entirely if we\'ve run out of steps.
            while (_obTourIdx < _obTourQueue.length) {
                const step = _obTourQueue[_obTourIdx];
                const els = _obTourFindTarget(step);
                if (!els) {
                    if (step.skipIfMissing) { _obTourIdx++; continue; }
                    // Required step missing — abort tour gracefully.
                    return _obTourFinish();
                }
                _obTourPaint(step, els);
                return;
            }
            _obTourFinish();
        }

        function _obTourPaint(step, els) {
            const overlay = document.getElementById('spotlightOverlay');
            const cutout  = document.getElementById('spotlightCutout');
            const card    = document.getElementById('spotlightCard');
            if (!overlay || !cutout || !card) return _obTourFinish();

            const rect = _obTourComputeRect(els, step.bundle);
            const pad = step.pad || 6;
            const radius = step.radius || 14;
            cutout.style.left   = (rect.left - pad) + 'px';
            cutout.style.top    = (rect.top  - pad) + 'px';
            cutout.style.width  = (rect.width  + pad * 2) + 'px';
            cutout.style.height = (rect.height + pad * 2) + 'px';
            cutout.style.borderRadius = (radius > 50 ? '999px' : radius + 'px');

            // Position the card on the opposite side of the screen from
            // the target — keeps the highlighted element fully visible.
            const isTopHalf = (rect.top + rect.height / 2) < window.innerHeight / 2;
            card.style.left = '50%';
            card.style.transform = 'translateX(-50%)';
            if (isTopHalf) {
                // Target is in the upper half → card goes below
                card.style.top = (rect.bottom + pad + 18) + 'px';
                card.style.bottom = '';
            } else {
                // Target is in the lower half → card goes above
                card.style.bottom = (window.innerHeight - rect.top + pad + 18) + 'px';
                card.style.top = '';
            }

            // Step indicator dots — visible only when tour has 2+ steps
            const visibleSteps = _obTourQueue.filter(s =>
                !s.skipIfMissing || _obTourFindTarget(s)).length;
            let dotsHtml = '';
            if (visibleSteps > 1) {
                // Map the absolute index to the visible-step index
                let visibleIdx = 0;
                for (let i = 0; i <= _obTourIdx; i++) {
                    const s = _obTourQueue[i];
                    if (!s.skipIfMissing || _obTourFindTarget(s)) {
                        if (i < _obTourIdx) visibleIdx++;
                    }
                }
                const dots = Array.from({ length: visibleSteps }, (_, i) =>
                    `<span class="spotlight-step-dot${i === visibleIdx ? ' spotlight-step-dot-active' : ''}"></span>`
                ).join('');
                dotsHtml = `<span class="spotlight-step-dots">${dots}</span>`;
            }

            const isLast = _obTourIdx === _obTourQueue.length - 1;
            card.innerHTML = `
                <div class="spotlight-eyebrow">
                    <span>${escapeHtml(step.eyebrow || '')}</span>
                    ${dotsHtml}
                </div>
                <div class="spotlight-emoji">${step.emoji || ''}</div>
                <h3 class="spotlight-title">${escapeHtml(step.title || '')}</h3>
                <p class="spotlight-body">${escapeHtml(step.body || '')}</p>
                <div class="spotlight-card-actions">
                    ${!isLast ? '<button class="spotlight-skip" onclick="_obTourSkip()">Skip tour</button>' : ''}
                    <button class="spotlight-cta" onclick="_obTourAdvance()">${escapeHtml(step.cta || 'Next')}</button>
                </div>
            `;
            overlay.style.display = 'block';
            document.body.style.overflow = 'hidden';
        }

        function _obTourFinish() {
            const overlay = document.getElementById('spotlightOverlay');
            if (overlay) overlay.style.display = 'none';
            document.body.style.overflow = '';
            const cb = _obTourOnComplete;
            _obTourQueue = [];
            _obTourIdx = 0;
            _obTourOnComplete = null;
            if (typeof cb === 'function') setTimeout(cb, 280);
        }

        // Public surface (window._obTour…) — used by inline onclick handlers
        // inside the spotlight card HTML.
        window._obTourAdvance = function() {
            _obTourIdx++;
            _obTourRender();
        };
        window._obTourSkip = function() {
            _obTourFinish();
        };

        // Kick off the post-picker tour. `opts.stepIds` filters which steps
        // run; `opts.onComplete` fires when the user finishes or skips.
        window.runOnboardingTour = function(opts = {}) {
            const ids = opts.stepIds || OB_TOUR_STEPS.map(s => s.id);
            _obTourQueue = OB_TOUR_STEPS.filter(s => ids.includes(s.id));
            _obTourIdx = 0;
            _obTourOnComplete = opts.onComplete || null;
            // Wait for layout to settle (the picker overlay just closed,
            // and switchTab('activities') needs a paint to render cards).
            setTimeout(_obTourRender, 320);
        };

        // Reposition on viewport changes — keeps the cutout & card pinned
        // to the live target if the user rotates or the page reflows.
        ['resize', 'orientationchange'].forEach(ev => {
            window.addEventListener(ev, () => {
                if (_obTourQueue.length && _obTourIdx < _obTourQueue.length) {
                    const step = _obTourQueue[_obTourIdx];
                    const els = _obTourFindTarget(step);
                    if (els) _obTourPaint(step, els);
                }
            });
        });

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
                <button class="unlock-popup-cta" onclick="acknowledgeTabUnlock('${tabName}')">Show me</button>
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
            // Build the preview pills row — each is a small chip with an
            // inline SVG glyph (no emoji-as-icons; brief §4).
            const PILL_ICONS = {
                bolt:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>',
                flame: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.6 2c.2 3.1-1.5 4.8-3.2 6.6-1.6 1.6-3 3.6-3 6.4 0 4.2 3.2 7 7 7s7-2.8 7-7c0-5-4.1-7.2-4.1-10.5 0-1.6.8-2.5.8-2.5s-2.7.4-4.5 0z"/></svg>',
                star:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21l1.2-6.9L2 9.3l6.9-1z"/></svg>',
            };
            const previewHtml = (s.preview || []).map(p =>
                `<span class="tutorial-preview-pill tutorial-preview-pill-${p.kind}">${PILL_ICONS[p.icon] || ''}${escapeHtml(p.label)}</span>`
            ).join('');
            const eyebrowHtml = s.eyebrow
                ? `<div class="tutorial-eyebrow">${escapeHtml(s.eyebrow)}</div>`
                : (TUTORIAL_STEPS.length > 1
                    ? `<div class="tutorial-progress">Step ${step + 1} of ${TUTORIAL_STEPS.length}</div>`
                    : '');
            card.innerHTML = `
                ${eyebrowHtml}
                <div class="tutorial-emoji">${s.emoji}</div>
                <h2 class="tutorial-title">${s.title}</h2>
                <p class="tutorial-body">${s.body}</p>
                ${previewHtml ? `<div class="tutorial-preview">${previewHtml}</div>` : ''}
                <button class="tutorial-cta" onclick="${s.action}">${escapeHtml(s.cta)}</button>
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
                        new Notification('Mindkraft', {
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
                currentXP:      window.userData.currentXP || 0,
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
            const lbEntries     = entries.filter(e => e.isMe || !hiddenUIDs.has(e.uid));
            const metricVal     = e => {
                if (metric === 'xpPerHour') return e.xpPerHour || 0;
                if (metric === 'xpToday')   return e.xpToday   || 0;
                return e.weeklyXP || 0;
            };
            const metricUnit = metric === 'xpPerHour' ? 'XP/hr' : 'XP';
            const sorted     = [...lbEntries].sort((a, b) => metricVal(b) - metricVal(a));
            const topEntries = sorted.slice(0, 10);

            // Sync sub-tab active state
            ['frTabToday','frTabWeek','frTabHour'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.remove('active');
            });
            const activeTabId = metric === 'xpToday' ? 'frTabToday' : metric === 'weeklyXP' ? 'frTabWeek' : 'frTabHour';
            const activeTab = document.getElementById(activeTabId);
            if (activeTab) activeTab.classList.add('active');

            lb.innerHTML = requestsHTML + (topEntries.length === 0
                ? '<div style="padding:28px 0;text-align:center;color:var(--color-text-secondary);font-size:13px;">No one on the leaderboard yet.</div>'
                : topEntries.map((e, i) => {
                    const rank   = i + 1;
                    const isMe   = e.isMe;
                    const val    = metricVal(e);
                    const rankEl = rank === 1
                        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f5c563" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>`
                        : rank === 2
                        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b0b8c8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>`
                        : rank === 3
                        ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#b08060" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>`
                        : `<span style="font-size:11px;font-weight:700;color:var(--color-text-secondary);">${rank}</span>`;
                    const avatar = e.photoURL
                        ? `<img src="${escapeHtml(e.photoURL)}" style="width:38px;height:38px;border-radius:50%;object-fit:cover;flex-shrink:0;">`
                        : `<div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--color-accent-blue),var(--color-progress));display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:#fff;flex-shrink:0;">${escapeHtml((e.displayName||'?')[0].toUpperCase())}</div>`;
                    return `<div onclick="openFriendProfileCard('${escapeHtml(e.uid)}')" class="fr-lb-row${isMe ? ' fr-lb-row-me' : ''}">
                        <div class="fr-lb-rank">${rankEl}</div>
                        ${avatar}
                        <div class="fr-lb-info">
                            <div class="fr-lb-name">${escapeHtml(e.displayName || 'Adventurer')}${isMe ? ' <span class="fr-you-badge">YOU</span>' : ''}</div>
                            <div class="fr-lb-meta">Lv ${e.level || 1} · ${escapeHtml(e.characterTitle || '')}</div>
                        </div>
                        <div class="fr-lb-val">
                            <span class="fr-lb-num">${val.toLocaleString()}</span>
                            <span class="fr-lb-unit">${metricUnit}</span>
                        </div>
                    </div>`;
                }).join(''));

            // ── 6. Add Friend ──────────────────────────────────────────────
            const myCode = window.userData.friendCode || '—';
            const atCap  = friends.length >= 20;
            add.innerHTML = `
                <div class="fr-add-card analytics-card">
                    <div class="fr-add-header">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--color-progress);flex-shrink:0;"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                        <div>
                            <div class="fr-add-title">Add a Friend</div>
                            <div class="fr-add-sub">Enter their MK code to connect</div>
                        </div>
                    </div>
                    <div class="fr-code-input-row">
                        <input id="friendCodeInput" type="text" maxlength="7" placeholder="MK-XXXX"
                            ${atCap ? 'disabled' : ''}
                            class="fr-code-input${atCap ? ' fr-code-input-disabled' : ''}"
                            oninput="this.value=this.value.toUpperCase()" onkeydown="if(event.key==='Enter')addFriendByCode()">
                        <button onclick="addFriendByCode()" ${atCap ? 'disabled' : ''} class="fr-add-btn${atCap ? ' fr-add-btn-disabled' : ''}">Add</button>
                    </div>
                    <div id="friendAddStatus" class="fr-add-status">${atCap ? 'Friend limit reached (20 max).' : ''}</div>

                    <div class="fr-divider"></div>

                    <div class="fr-mycode-section">
                        <div class="fr-mycode-label">Your friend code</div>
                        <div class="fr-mycode-box">
                            <span class="fr-mycode-value" id="frMyCodeDisplay">${escapeHtml(myCode)}</span>
                            <div class="fr-mycode-actions">
                                <button class="fr-mycode-btn" onclick="copyFriendCode()" title="Copy code">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                    Copy
                                </button>
                                <button class="fr-mycode-btn fr-mycode-btn-share" onclick="shareFriendCode()" title="Share code">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                                    Share
                                </button>
                            </div>
                        </div>
                        <div class="fr-mycode-hint">Share this code with friends so they can add you</div>
                    </div>
                </div>`;

            // ── 7. All Friends list ────────────────────────────────────────
            const friendEntries = entries.filter(e => !e.isMe);
            if (friendEntries.length === 0) {
                all.innerHTML = `
                    <div class="fr-section-kicker">Friends (0)</div>
                    <div class="fr-empty">Add a friend using their MK code above</div>`;
            } else {
                all.innerHTML = `
                    <div class="fr-section-kicker">Friends (${friendEntries.length}/20)</div>
                    ${friendEntries.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '')).map(e => {
                        const avatar = e.photoURL
                            ? `<img src="${escapeHtml(e.photoURL)}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0;">`
                            : `<div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--color-accent-blue),var(--color-progress));display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:#fff;flex-shrink:0;">${escapeHtml((e.displayName || '?')[0].toUpperCase())}</div>`;
                        return `<div onclick="openFriendProfileCard('${escapeHtml(e.uid)}')" class="fr-friend-row">
                            ${avatar}
                            <div class="fr-friend-info">
                                <div class="fr-friend-name">${escapeHtml(e.displayName || 'Adventurer')}</div>
                                <div class="fr-friend-meta">Lv ${e.level || 1} · ${escapeHtml(e.characterTitle || '')}</div>
                            </div>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="color:var(--color-text-secondary);flex-shrink:0;"><polyline points="9 18 15 12 9 6"/></svg>
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

            const isMe       = !!data.isMe;
            const catXP      = data.categoryXP || {};
            const level      = data.level || 1;
            const isMax      = level >= 100;
            const xpNeeded   = isMax ? 0 : (typeof calculateXPForLevel === 'function' ? calculateXPForLevel(level) : 100);
            const xpCurrent  = data.currentXP != null ? data.currentXP : 0;
            const pct = isMax ? 100 : xpNeeded > 0 ? Math.min(100, (xpCurrent / xpNeeded) * 100) : 0;

            // Weekly XP — only counts if it's the current ISO week
            const currentWeek = getISOWeekLabel();
            const wXP  = (data.weeklyXPWeek === currentWeek) ? (data.weeklyXP || 0) : 0;
            const xphr = isMe
                ? computeXPPerHour((function() {
                    const a = [];
                    (window.userData.dimensions || []).forEach(function(d) {
                        (d.paths || []).forEach(function(p) {
                            (p.activities || []).forEach(function(x) { a.push(x); });
                        });
                    });
                    return a;
                })())
                : (data.xpPerHour || 0);

            const avatar = data.photoURL
                ? `<img src="${escapeHtml(data.photoURL)}" alt="">`
                : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:36px;font-weight:700;background:linear-gradient(135deg,var(--color-accent-blue),var(--color-progress));border-radius:50%;">${escapeHtml(((data.displayName || '?')[0] || '?').toUpperCase())}</div>`;

            const statTiles = [
                { val: (data.totalXP || 0).toLocaleString(),  lbl: 'Total XP' },
                { val: wXP.toLocaleString(),                  lbl: 'This Week' },
                { val: (xphr || 0).toLocaleString(),          lbl: 'XP / Hour' },
                { val: data.bestStreak || 0,                  lbl: 'Best Streak' },
                { val: data.activeDays || 0,                  lbl: 'Active Days' },
                { val: '★ ' + level,                          lbl: 'Level' },
            ];

            const isHidden = (window.userData.leaderboardHidden || []).indexOf(uid) !== -1;

            document.getElementById('friendProfileContent').innerHTML = `
                <!-- Identity hero -->
                <div class="pf-card pf-hero">
                    <div class="pf-avatar-wrap">
                        <div class="pf-avatar">${avatar}</div>
                    </div>
                    <div class="pf-title">${escapeHtml(data.characterTitle || '')}</div>
                    <div class="pf-name">${escapeHtml(data.displayName || 'Adventurer')}</div>
                    <div class="pf-meta">${isMe ? 'You · ' : ''}Level ${level}${isMax ? ' · MAX' : ''}</div>
                </div>

                <!-- Stats card -->
                <div class="pf-card">
                    <div class="pf-xp-hero">
                        <div class="pf-xp-row">
                            <div class="pf-level-cluster">
                                <span class="pf-level-kicker">Level</span>
                                <span class="pf-level-num">${level}</span>
                            </div>
                            <div class="pf-xp-cluster">
                                <span class="pf-xp-current-line"><strong>${isMax ? 'MAX' : `${xpCurrent.toLocaleString()} / ${xpNeeded.toLocaleString()} XP`}</strong></span>
                                ${isMax
                                    ? '<span class="pf-xp-tonext">★ Max level</span>'
                                    : `<span class="pf-xp-tonext">${Math.max(0, xpNeeded - xpCurrent).toLocaleString()} to next</span>`}
                            </div>
                        </div>
                        <div class="pf-bar-track">
                            <div class="pf-bar-fill" style="width:${pct.toFixed(1)}%;"></div>
                        </div>
                    </div>
                    <div class="pf-stats-grid">
                        ${statTiles.map(function(t) { return `<div class="pf-stat-tile"><div class="pf-stat-val">${t.val}</div><div class="pf-stat-lbl">${t.lbl}</div></div>`; }).join('')}
                    </div>
                </div>

                <!-- Life balance -->
                <div class="pf-card">
                    <div class="pf-section-head">
                        <span class="pf-collapse-icon pf-collapse-icon-blue">
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><polygon points="12 2 14.5 8 21 8.5 16 13 17.5 19.5 12 16 6.5 19.5 8 13 3 8.5 9.5 8 12 2"/></svg>
                        </span>
                        <div style="flex:1;min-width:0;">
                            <div class="pf-section-title">Life Balance</div>
                            <div class="pf-section-sub">${isMe ? 'Your' : 'Their'} activity fingerprint across life areas</div>
                        </div>
                    </div>
                    <div class="pf-spider-wrap">
                        <div id="friendSpiderContainer" class="pf-spider-canvas-host"></div>
                    </div>
                    <div id="friendSpiderLegend" class="pf-spider-legend"></div>
                </div>

                ${!isMe ? `
                <div style="display:flex;gap:8px;margin: 4px 0 8px;">
                    <button onclick="toggleLeaderboardVisibility('${escapeHtml(uid)}')" class="pf-ghost-btn" style="flex:1;justify-content:center;padding:10px;font-size:12px;">
                        ${isHidden ? '+ Add to Leaderboard' : 'Remove from Leaderboard'}
                    </button>
                    <button onclick="removeFriend('${escapeHtml(uid)}')" class="pf-ghost-btn" style="flex:1;justify-content:center;padding:10px;font-size:12px;">
                        Remove Friend
                    </button>
                </div>` : ''}`;

            overlay.style.display = 'flex';

            // Render shared spider chart after the DOM is in place
            const fContainer = document.getElementById('friendSpiderContainer');
            const fLegend    = document.getElementById('friendSpiderLegend');
            if (fContainer) {
                // Small delay so the canvas host has its width measured inside the now-visible overlay
                setTimeout(function() {
                    renderSpiderChartCanvas(fContainer, fLegend, catXP, {
                        emptyTitle: isMe ? 'No category data yet' : 'No shared activity yet',
                        emptyHint:  isMe
                            ? 'Use "Configure Life Categories" below to assign activities to life areas.'
                            : 'Activities need to be tagged into life areas before they can show up here.',
                        retryFn: function() {
                            const c = document.getElementById('friendSpiderContainer');
                            const l = document.getElementById('friendSpiderLegend');
                            if (c) renderSpiderChartCanvas(c, l, catXP, { emptyTitle: 'No category data yet' });
                        }
                    });
                }, 30);
            }
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

        // ════════════════════════════════════════════════════════════════════
        // ── CHALLENGE RACES — friend-vs-friend competition ──────────────────
        // A personal challenge can be sent to ONE friend. On accept, its
        // activities are ported into the friend's system (uncategorized, or
        // mapped to activities they already do) and both race to finish
        // first. Shared state lives in the `challengeInvites` collection
        // (deterministic id `${inviteeUid}_${inviterUid}_${challengeId}`);
        // the doc carries a full challenge SNAPSHOT so it survives the
        // inviter deleting their copy, plus a per-uid `race` progress map
        // synced like gcSyncProgress. The group-challenge system is untouched.
        // ════════════════════════════════════════════════════════════════════

        const RACE_COL = 'challengeInvites';

        function raceMyName() {
            return (window.userData.profile?.username) || window.currentUser?.displayName || 'A friend';
        }
        // Capped aggregate progress — same math the challenge card shows.
        function raceChallengeCurrent(ch) {
            const ids = ch.activityIds && ch.activityIds.length ? ch.activityIds : (ch.activityId ? [ch.activityId] : []);
            if (ids.length && ch.activityTargets) {
                return ids.reduce((s, id) => s + Math.min((ch.activityProgress || {})[id] || 0, ch.activityTargets[id] || 1), 0);
            }
            return ch.currentCount || 0;
        }

        // ── Send ──────────────────────────────────────────────────────────
        window.openChallengeFriendPicker = async function(challengeIndex) {
            const ch = window.userData.challenges[challengeIndex];
            const myUID = window.currentUser?.uid;
            if (!ch || !myUID) return;
            const friends = window.userData.friends || [];
            window._racePickerChallengeIndex = challengeIndex;
            const list = document.getElementById('challengeFriendPickerList');
            if (!friends.length) {
                list.innerHTML = '<p style="color:var(--color-text-secondary);font-size:13px;">No friends yet — add friends in the Friends tab first.</p>';
            } else {
                list.innerHTML = '<p style="color:var(--color-text-secondary);font-size:12px;">Loading friends…</p>';
                const rows = await Promise.all(friends.map(async uid => {
                    try {
                        const pSnap = await getDoc(doc(db, 'publicProfiles', uid));
                        return { uid, name: pSnap.exists() ? (pSnap.data().displayName || 'Friend') : 'Friend' };
                    } catch (e) { return { uid, name: 'Friend' }; }
                }));
                list.innerHTML = rows.map(r => `
                    <div class="gc-friend-invite-row">
                        <span class="gc-friend-invite-name">${escapeHtml(r.name)}</span>
                        <button class="gc-friend-invite-btn" onclick="sendChallengeRaceInvite('${r.uid}','${escapeHtml(r.name).replace(/'/g, '&#39;')}')">Challenge</button>
                    </div>`).join('');
            }
            document.getElementById('challengeFriendPickerModal').classList.add('active');
        };
        window.closeChallengeFriendPicker = function() {
            document.getElementById('challengeFriendPickerModal').classList.remove('active');
        };

        window.sendChallengeRaceInvite = async function(inviteeUid, inviteeName) {
            const myUID = window.currentUser?.uid;
            const idx = window._racePickerChallengeIndex;
            const ch = (idx !== undefined && idx !== null) ? window.userData.challenges[idx] : null;
            if (!myUID || !ch) return;
            // Snapshot the challenge + its activities so the invite is
            // self-contained: display, port-in, and race all read from it.
            const ids = ch.activityIds && ch.activityIds.length ? ch.activityIds : (ch.activityId ? [ch.activityId] : []);
            const actSnapshots = ids.map(id => {
                const a = findActivityById(id);
                return {
                    id: id,
                    name: a ? a.name : 'Activity',
                    description: (a && a.description) || '',
                    frequency: (a && a.frequency) || 'daily',
                    baseXP: (a && a.baseXP) || 10,
                    target: (ch.activityTargets && ch.activityTargets[id]) || 1
                };
            });
            const inviteId = `${inviteeUid}_${myUID}_${ch.id}`;
            try {
                await setDoc(doc(db, RACE_COL, inviteId), {
                    inviteeUid, inviterUid: myUID,
                    inviterName: raceMyName(),
                    challengeId: ch.id,
                    challenge: {
                        name: ch.name || '',
                        description: ch.description || '',
                        endDate: ch.endDate || null,
                        bonusXP: ch.bonusXP || 0,
                        targetCount: ch.targetCount || 0,
                        activities: actSnapshots
                    },
                    status: 'pending',
                    race: {
                        [myUID]: {
                            name: raceMyName(),
                            currentCount: raceChallengeCurrent(ch),
                            targetCount: ch.targetCount || 0,
                            status: 'active',
                            finishedAt: null
                        }
                    },
                    createdAt: new Date().toISOString()
                }, { merge: true }); // re-invite after a decline resets to pending
                ch.race = { inviteId, withUid: inviteeUid, withName: inviteeName, role: 'inviter', lastOpponent: null };
                await saveUserData();
                closeChallengeFriendPicker();
                showToast(`Challenge sent to ${inviteeName}!`, 'blue');
                renderChallenges();
            } catch (e) {
                console.warn('Race invite failed:', e);
                showToast('Failed to send challenge.', 'red');
            }
        };

        // ── Receive: login popup ──────────────────────────────────────────
        window.checkPendingChallengeInvites = async function() {
            const ud = window.userData;
            const myUID = window.currentUser?.uid;
            if (!ud || !myUID || !ud.onboardingComplete) return;
            const ts = ud.tutorialStep ?? -1;
            if (ts >= 0 && ts < 99 && ts < TUTORIAL_STEPS.length) return;
            const onboarding = document.getElementById('onboardingOverlay');
            if (onboarding && onboarding.style.display !== 'none' && onboarding.style.display !== '') return;
            // Don't stack on top of tab-unlock popups
            if (window._pendingUnlockQueue && window._pendingUnlockQueue.length > 0) return;
            if (window._raceInviteShownThisSession) return;
            try {
                const q = query(collection(db, RACE_COL),
                    where('inviteeUid', '==', myUID),
                    where('status', '==', 'pending'));
                const snap = await getDocs(q);
                if (snap.empty) return;
                // One invite modal per login — first pending wins
                const docSnap = snap.docs[0];
                window._raceInviteShownThisSession = true;
                showChallengeInviteModal(docSnap.id, docSnap.data());
            } catch (e) { console.warn('Pending race invites check failed (non-critical):', e); }
        };

        function showChallengeInviteModal(inviteId, invite) {
            window._activeRaceInvite = { id: inviteId, data: invite };
            window._raceMappings = {}; // snapshotActivityId → my existing activityId
            document.getElementById('raceInviterLine').textContent =
                (invite.inviterName || 'A friend') + ' challenged you!';
            document.getElementById('raceChallengeName').textContent = invite.challenge?.name || 'Challenge';
            const descEl = document.getElementById('raceChallengeDesc');
            descEl.textContent = invite.challenge?.description || '';
            descEl.style.display = invite.challenge?.description ? '' : 'none';
            const metaEl = document.getElementById('raceChallengeMeta');
            const bits = [];
            if (invite.challenge?.bonusXP) bits.push('+' + invite.challenge.bonusXP + ' XP bonus');
            if (invite.challenge?.endDate) bits.push('ends ' + invite.challenge.endDate);
            metaEl.textContent = bits.join(' · ');
            raceRenderInviteActivityRows();
            document.getElementById('challengeInviteModal').classList.add('active');
        }
        function raceRenderInviteActivityRows() {
            const invite = window._activeRaceInvite?.data;
            const listEl = document.getElementById('raceActivityList');
            if (!invite || !listEl) return;
            const acts = invite.challenge?.activities || [];
            listEl.innerHTML = acts.map(a => {
                const mappedId = window._raceMappings[a.id];
                const mapped = mappedId ? findActivityById(mappedId) : null;
                return `
                <div class="race-act-row">
                    <div class="race-act-info">
                        <span class="race-act-name">${escapeHtml(a.name)}${a.target > 1 ? ' <span class="race-act-target">×' + a.target + '</span>' : ''}</span>
                        <span class="race-act-sub">${mapped
                            ? 'Counts as: ' + escapeHtml(mapped.name)
                            : 'Will be added to your activities'}</span>
                    </div>
                    <button class="race-map-btn${mapped ? ' mapped' : ''}" onclick="raceMapActivity('${a.id}')">
                        ${mapped ? 'Change' : 'I already do this'}
                    </button>
                </div>`;
            }).join('');
        }
        window.raceMapActivity = function(snapshotActivityId) {
            questOpenActivityPicker(function(myActivityId) {
                window._raceMappings[snapshotActivityId] = myActivityId;
                raceRenderInviteActivityRows();
            }, 'I already do this', 'Pick your existing activity — its completions will count toward the race.');
        };
        window.closeChallengeInviteModal = function() {
            document.getElementById('challengeInviteModal').classList.remove('active');
            window._activeRaceInvite = null;
        };

        window.declineChallengeInvite = async function() {
            const inv = window._activeRaceInvite;
            if (!inv) return;
            try {
                await updateDoc(doc(db, RACE_COL, inv.id), { status: 'declined' });
            } catch (e) { console.warn('Decline failed:', e); }
            closeChallengeInviteModal();
            showToast('Challenge declined.', 'olive');
        };

        window.acceptChallengeInvite = async function() {
            const inv = window._activeRaceInvite;
            const myUID = window.currentUser?.uid;
            if (!inv || !myUID) return;
            const invite = inv.data;
            const snapActs = invite.challenge?.activities || [];

            // Idempotence: if this invite was already materialized locally,
            // just re-mark accepted and bail.
            const existing = (window.userData.challenges || []).find(c => c.race && c.race.inviteId === inv.id);
            if (existing) {
                try { await updateDoc(doc(db, RACE_COL, inv.id), { status: 'accepted' }); } catch (e) {}
                closeChallengeInviteModal();
                return;
            }

            // Capacity pre-check for the whole clone batch — abort BEFORE
            // mutating anything so a failed accept leaves no partial state.
            const toClone = snapActs.filter(a => !window._raceMappings[a.id]);
            const { total, limit } = getActivityCounts();
            if (total + toClone.length > limit) {
                alert(`This challenge adds ${toClone.length} activities but you only have ${Math.max(0, limit - total)} free slots. Map more of them to activities you already do, or level up for more slots.`);
                return;
            }

            // 1. Clone unmapped activities into Uncategorized
            const { di, pi } = getOrCreateUncategorized();
            const targetPath = window.userData.dimensions[di].paths[pi];
            const idMap = {}; // snapshot id → local id
            snapActs.forEach((a, i) => {
                if (window._raceMappings[a.id]) {
                    idMap[a.id] = window._raceMappings[a.id];
                    return;
                }
                const newId = Date.now().toString() + i;
                targetPath.activities.push({
                    id: newId,
                    name: a.name,
                    baseXP: a.baseXP || 10,
                    frequency: a.frequency || 'daily',
                    description: a.description || '',
                    isNegative: false, isSkipNegative: false,
                    allowMultiplePerDay: false,
                    streak: 0, skipStreak: 0, lastCompleted: null, cycleCompletions: 0,
                    totalXP: 0, completionCount: 0, isFavorite: false,
                    completionHistory: [], cycleHistory: [], streakShields: 0,
                    createdAt: new Date().toISOString()
                });
                idMap[a.id] = newId;
            });

            // 2. Materialize the challenge locally with race metadata
            const activityIds = snapActs.map(a => idMap[a.id]);
            const activityTargets = {};
            const activityProgress = {};
            snapActs.forEach(a => {
                activityTargets[idMap[a.id]] = a.target || 1;
                activityProgress[idMap[a.id]] = 0;
            });
            if (!window.userData.challenges) window.userData.challenges = [];
            window.userData.challenges.push({
                id: Date.now().toString() + '_race',
                name: invite.challenge?.name || 'Challenge',
                description: invite.challenge?.description || '',
                targetCount: invite.challenge?.targetCount || snapActs.reduce((s, a) => s + (a.target || 1), 0),
                bonusXP: invite.challenge?.bonusXP || 0,
                startDate: localToday(),
                endDate: invite.challenge?.endDate || null,
                activityIds, activityTargets, activityProgress,
                activityId: null, currentCount: 0,
                metricEnabled: false, metricQty: null, metricUnit: null, metricCurrent: 0,
                activityProgressCollapsed: true,
                enforceActivities: false, enforceDateRange: false,
                status: 'active',
                createdAt: new Date().toISOString(),
                race: { inviteId: inv.id, withUid: invite.inviterUid, withName: invite.inviterName || 'Friend', role: 'invitee', lastOpponent: null }
            });

            // 3. Seed my side of the race on the invite doc
            try {
                await updateDoc(doc(db, RACE_COL, inv.id), {
                    status: 'accepted',
                    [`race.${myUID}`]: {
                        name: raceMyName(),
                        currentCount: 0,
                        targetCount: invite.challenge?.targetCount || 0,
                        status: 'active',
                        finishedAt: null
                    }
                });
            } catch (e) { console.warn('Race accept doc update failed:', e); }

            await saveUserData();
            closeChallengeInviteModal();
            updateDashboard();
            showToast('Race on! Beat ' + (invite.inviterName || 'your friend') + ' to it.', 'green');
        };

        // ── Sync + resolution ─────────────────────────────────────────────
        window.syncChallengeRaceProgress = async function() {
            const myUID = window.currentUser?.uid;
            if (!myUID) return;
            const raced = (window.userData.challenges || []).filter(c => c.race && c.race.inviteId);
            if (!raced.length) return;
            let changed = false;
            for (const ch of raced) {
                try {
                    const ref = doc(db, RACE_COL, ch.race.inviteId);
                    const snap = await getDoc(ref);
                    if (!snap.exists()) {
                        // Doc gone — opponent nuked it; race dissolves quietly
                        ch.race = null;
                        changed = true;
                        showToast('A challenge race was cancelled.', 'olive');
                        continue;
                    }
                    const inv = snap.data();
                    if (inv.status === 'declined' && ch.race.role === 'inviter' && !ch.race.declineSeen) {
                        ch.race.declineSeen = true;
                        changed = true;
                        showToast((ch.race.withName || 'Your friend') + ' declined the challenge.', 'olive');
                        continue;
                    }
                    if (inv.status !== 'accepted') continue;

                    // Push my progress
                    const cur = raceChallengeCurrent(ch);
                    const myStatus = ch.status === 'completed' ? 'completed' : (ch.status === 'failed' ? 'failed' : 'active');
                    const mine = (inv.race || {})[myUID] || {};
                    const myFinishedAt = myStatus === 'completed' ? (mine.finishedAt || new Date().toISOString()) : null;
                    if (mine.currentCount !== cur || mine.status !== myStatus || (mine.finishedAt || null) !== myFinishedAt) {
                        await updateDoc(ref, {
                            [`race.${myUID}`]: {
                                name: raceMyName(),
                                currentCount: cur,
                                targetCount: ch.targetCount || 0,
                                status: myStatus,
                                finishedAt: myFinishedAt
                            }
                        });
                    }

                    // Cache opponent for synchronous card rendering
                    const opp = (inv.race || {})[ch.race.withUid] || null;
                    const oppCache = opp ? {
                        currentCount: opp.currentCount || 0,
                        targetCount: opp.targetCount || 0,
                        status: opp.status || 'active',
                        finishedAt: opp.finishedAt || null
                    } : null;
                    if (JSON.stringify(ch.race.lastOpponent || null) !== JSON.stringify(oppCache)) {
                        ch.race.lastOpponent = oppCache;
                        changed = true;
                    }

                    // Opponent abandoned → race dissolves
                    if (opp && opp.status === 'abandoned' && !ch.race.resultSeen) {
                        ch.race.resultSeen = true;
                        changed = true;
                        showToast((ch.race.withName || 'Your friend') + ' left the race.', 'olive');
                        continue;
                    }

                    // Resolution: first finishedAt wins (tie → lower uid)
                    if (!ch.race.resultSeen) {
                        const oppFin = opp && opp.finishedAt;
                        if (myFinishedAt || oppFin) {
                            let iWin = false, resolved = false;
                            if (myFinishedAt && !oppFin) { iWin = true; resolved = true; }
                            else if (!myFinishedAt && oppFin) { iWin = false; resolved = true; }
                            else if (myFinishedAt && oppFin) {
                                resolved = true;
                                iWin = myFinishedAt < oppFin || (myFinishedAt === oppFin && myUID < ch.race.withUid);
                            }
                            if (resolved) {
                                ch.race.resultSeen = true;
                                ch.race.won = iWin;
                                changed = true;
                                showToast(iWin
                                    ? '🏆 You beat ' + (ch.race.withName || 'your friend') + ' — race won!'
                                    : (ch.race.withName || 'Your friend') + ' finished first — race complete.',
                                    iWin ? 'green' : 'olive');
                            }
                        }
                    }
                } catch (e) { console.warn('Race sync failed (non-critical):', e); }
            }
            if (changed) {
                saveUserData().catch(() => {});
                if (window.currentTab === 'challenges') renderChallenges();
            }
        };

        // Debounced trigger — called from the challenge-progress funnels
        // (updateChallengeProgress / undoChallengeProgress) and race hooks.
        let _raceSyncTimer = null;
        function raceSyncSoon() {
            const has = (window.userData?.challenges || []).some(c => c.race && c.race.inviteId);
            if (!has) return;
            clearTimeout(_raceSyncTimer);
            _raceSyncTimer = setTimeout(() => {
                if (typeof window.syncChallengeRaceProgress === 'function') {
                    window.syncChallengeRaceProgress().catch(() => {});
                }
            }, 1500);
        }

        // Completing/undoing a challenge must push race state promptly
        (function() {
            const _origComplete = window.completeChallenge;
            window.completeChallenge = async function(index) {
                await _origComplete(index);
                raceSyncSoon();
            };
            const _origUndo = window.undoChallenge;
            window.undoChallenge = async function(index) {
                await _origUndo(index);
                raceSyncSoon();
            };
            // Deleting a raced challenge marks my side abandoned so the
            // opponent's next sync dissolves their race badge too.
            const _origDelete = window.deleteChallenge;
            window.deleteChallenge = async function(index) {
                const ch = window.userData.challenges[index];
                const raceInfo = ch && ch.race && ch.race.inviteId
                    ? { inviteId: ch.race.inviteId } : null;
                const before = (window.userData.challenges || []).length;
                await _origDelete(index);
                const deleted = (window.userData.challenges || []).length < before;
                if (deleted && raceInfo && window.currentUser) {
                    updateDoc(doc(db, RACE_COL, raceInfo.inviteId), {
                        [`race.${window.currentUser.uid}.status`]: 'abandoned'
                    }).catch(() => {});
                }
            };
        })();

        // ════════════════════════════════════════════════════════════════════
        // ── CHARACTER TECH TREE ──────────────────────────────────────────────
        // AI-generated skill tree grown from the user's goal statement.
        // Generation runs server-side (scripts/generate-tech-tree.js via GitHub
        // Actions); the client writes techTree.pendingRequest and listens on
        // its own user doc for the worker's result.
        // ════════════════════════════════════════════════════════════════════

        // Smart mastery defaults by frequency (spec §3) — starting point, editable.
        var TT_MASTERY_DEFAULTS = {
            daily:      { count: 15, windowDays: 30 },
            weekly:     { count: 6,  windowDays: 90 },
            biweekly:   { count: 4,  windowDays: 120 },
            monthly:    { count: 3,  windowDays: 180 },
            occasional: { count: 3,  windowDays: null },
            'one-time': { count: 3,  windowDays: null },
            custom:     { count: 6,  windowDays: 90 },
        };
        var TT_REGEN_FREE_DAYS   = 30;
        var TT_REVISION_LIMIT    = 2;
        var TT_REVISION_WINDOW_H = 24;

        function ttMasteryDefaultFor(frequency) {
            return TT_MASTERY_DEFAULTS[frequency] || TT_MASTERY_DEFAULTS.daily;
        }

        // Inline SVG icons — the design system uses stroked SVG glyphs, never
        // emoji, as UI primitives. Same stroke style as the rest of the app.
        function ttIcon(name, size) {
            size = size || 14;
            var fill = { star: true }[name] ? ' fill="currentColor" stroke="none"' : ' fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';
            var paths = {
                lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
                star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
                spark: '<path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="M5.6 5.6l2.2 2.2"/><path d="M16.2 16.2l2.2 2.2"/><path d="M18.4 5.6l-2.2 2.2"/><path d="M7.8 16.2l-2.2 2.2"/>',
                plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
                check: '<polyline points="20 6 9 17 4 12"/>',
                link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
                edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
                x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
                archive: '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>',
                refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
                revive: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
                target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
                branch: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
                expand: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
                web: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
                circle: '<circle cx="12" cy="12" r="9"/>',
                flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
            };
            return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24"' + fill + ' aria-hidden="true" style="flex-shrink:0;">' + (paths[name] || '') + '</svg>';
        }

        function ensureTechTree() {
            if (!window.userData) return null;
            if (!window.userData.techTree) {
                window.userData.techTree = {
                    status: 'not_started',
                    goalText: '',
                    goalTextUpdatedAt: null,
                    lastGeneratedAt: null,
                    revisionsUsedSinceGeneration: 0,
                    revisionWindowExpiresAt: null,
                    pendingRequest: null,
                    nodes: [],
                    connections: []
                };
            }
            var tt = window.userData.techTree;
            if (!tt.nodes) tt.nodes = [];
            if (!tt.connections) tt.connections = [];
            return tt;
        }

        // ── Activity lookups ─────────────────────────────────────────────
        // Flat view over dimensions[].paths[].activities[] with dim context.
        function ttAllActivities() {
            var out = [];
            (window.userData.dimensions || []).forEach(function(dim) {
                (dim.paths || []).forEach(function(path) {
                    (path.activities || []).forEach(function(act) {
                        out.push({ activity: act, dim: dim, path: path });
                    });
                });
            });
            return out;
        }
        function ttFindActivity(activityId) {
            var hit = null;
            ttAllActivities().some(function(e) {
                if (e.activity.id === activityId) { hit = e; return true; }
                return false;
            });
            return hit;
        }
        function ttDimHexRaw(dimId) {
            var dims = window.userData.dimensions || [];
            var idx = dims.findIndex(function(d) { return d.id === dimId; });
            var dim = idx !== -1 ? dims[idx] : null;
            if (dim && DIM_HEX_MAP[dim.color]) return DIM_HEX_MAP[dim.color];
            // Dimension without an explicit color (e.g. Uncategorized) — assign a
            // stable palette color by position so tree sectors stay distinguishable.
            if (dim) return DIM_HEX_MAP[DIM_COLOR_ORDER[idx % DIM_COLOR_ORDER.length]] || '#5a9fd4';
            return '#5a9fd4';
        }
        function ttDimName(dimId) {
            var dim = (window.userData.dimensions || []).find(function(d) { return d.id === dimId; });
            return dim ? dim.name : 'Uncategorized';
        }

        // ── Mastery ──────────────────────────────────────────────────────
        // Proportional progress 0→1. Permanent once techTreeMasteredAt set.
        function ttMasteryProgress(activity) {
            var threshold = activity.techTreeMastery || ttMasteryDefaultFor(activity.frequency);
            var target = Math.max(1, threshold.count || 1);
            var windowDays = threshold.windowDays;
            var cutoff = windowDays ? (Date.now() - windowDays * 86400000) : null;
            var count = (activity.completionHistory || []).filter(function(e) {
                if (e.isPenalty || (e.xp || 0) <= 0) return false;
                return cutoff === null || new Date(e.date).getTime() >= cutoff;
            }).length;
            var mastered = !!activity.techTreeMasteredAt;
            return {
                count: count, target: target, windowDays: windowDays,
                mastered: mastered,
                pct: mastered ? 1 : Math.min(1, count / target)
            };
        }

        function ttNodeIsMastered(node) {
            if (!node || node.kind !== 'existing' || !node.activityId) return false;
            var e = ttFindActivity(node.activityId);
            return !!(e && e.activity.techTreeMasteredAt);
        }

        function ttNodePrereqsMet(node) {
            var tt = ensureTechTree();
            return (node.prerequisites || []).every(function(pr) {
                if (pr.type === 'node_mastered') {
                    var target = tt.nodes.find(function(n) { return n.id === pr.nodeId; });
                    if (!target) return true;               // dangling ref — don't brick the branch
                    if (target.lifecycle === 'archived') return false; // dead branch stays locked
                    return ttNodeIsMastered(target);
                }
                if (pr.type === 'activity_mastered') {
                    var e = ttFindActivity(pr.activityId);
                    return !!(e && e.activity.techTreeMasteredAt);
                }
                return true;
            });
        }

        // Flip techTreeMasteredAt where earned, then recompute locked/available
        // lifecycles. Returns true when anything changed (caller persists).
        // Runs inside processStreakPauses (login) and after each completion.
        function evaluateTechTreeMastery() {
            if (!window.userData) return false;
            var changed = false;
            ttAllActivities().forEach(function(e) {
                var act = e.activity;
                if (!act.techTreeMastery || act.techTreeMasteredAt) return;
                var prog = ttMasteryProgress(act);
                if (prog.count >= prog.target) {
                    act.techTreeMasteredAt = new Date().toISOString();
                    changed = true;
                    try { showToast('🏅 Mastered: ' + act.name, 'green'); } catch (err) {}
                }
            });
            var tt = window.userData.techTree;
            if (tt && tt.nodes) {
                tt.nodes.forEach(function(node) {
                    // Nodes backed by a real activity follow that activity's
                    // CURRENT dimension — recategorizing an activity moves its
                    // node to the right sector on the next pass, so the tree
                    // never locks in a stale placement.
                    if (node.activityId) {
                        var e = ttFindActivity(node.activityId);
                        if (e && node.dimensionId !== e.dim.id) {
                            node.dimensionId = e.dim.id;
                            changed = true;
                        }
                    }
                    if (node.lifecycle === 'archived' || node.lifecycle === 'active') return;
                    var want = ttNodePrereqsMet(node) ? 'available' : 'locked';
                    if (node.lifecycle !== want) { node.lifecycle = want; changed = true; }
                });
            }
            return changed;
        }

        // Tier = 1 + longest prerequisite chain (activity prereqs anchor at tier 1).
        function ttRecomputeTiers() {
            var tt = ensureTechTree();
            var byId = {};
            tt.nodes.forEach(function(n) { byId[n.id] = n; });
            var memo = {};
            function depth(node, guard) {
                if (!node) return 0;
                if (memo[node.id] !== undefined) return memo[node.id];
                if (guard[node.id]) return 1; // cycle guard
                guard[node.id] = true;
                var d = 1;
                (node.prerequisites || []).forEach(function(pr) {
                    if (pr.type === 'node_mastered' && byId[pr.nodeId]) {
                        d = Math.max(d, 1 + depth(byId[pr.nodeId], guard));
                    } else if (pr.type === 'activity_mastered') {
                        d = Math.max(d, 2);
                    }
                });
                delete guard[node.id];
                memo[node.id] = d;
                return d;
            }
            tt.nodes.forEach(function(n) { n.tier = depth(n, {}); });
        }

        // ── Gate (spec §2) ───────────────────────────────────────────────
        function ttGateStatus() {
            var tt = ensureTechTree();
            var activityCount = ttAllActivities().length;
            var hasGoal = !!(tt && tt.goalText && tt.goalText.trim());
            return { activityCount: activityCount, hasGoal: hasGoal, met: activityCount >= 3 && hasGoal };
        }

        // ── Goal statement ───────────────────────────────────────────────
        window.ttSaveGoal = function() {
            var el = document.getElementById('ttGoalInput');
            if (!el) return;
            var tt = ensureTechTree();
            var text = el.value.trim();
            if (text === (tt.goalText || '')) { renderTechTree(); return; }
            tt.goalText = text;
            tt.goalTextUpdatedAt = new Date().toISOString();
            saveUserData().catch(function() {});
            showToast(text ? '🎯 Goal saved' : 'Goal cleared', 'blue');
            renderTechTree();
        };

        // ── Generation requests (spec §11, §16) ──────────────────────────
        // The client never calls the model — it flags a pendingRequest on its
        // own doc; the scheduled worker is the sole authority that honors it.
        function ttSubmitRequest(req) {
            var tt = ensureTechTree();
            tt.pendingRequest = Object.assign({ requestedAt: new Date().toISOString() }, req);
            delete tt.lastError;
            saveUserData().catch(function() {});
            ttEnsureListener();
            renderTechTree();
        }

        window.ttRequestGenerate = function() {
            var tt = ensureTechTree();
            if (tt.pendingRequest) return;
            var gate = ttGateStatus();
            if (!gate.met) { showToast('🔒 Need 3+ activities and a goal first', 'olive'); return; }
            ttSubmitRequest({ type: 'generate' });
        };

        function ttRegenCost() {
            var tt = ensureTechTree();
            if (!tt.lastGeneratedAt) return 0;
            var ageDays = (Date.now() - new Date(tt.lastGeneratedAt).getTime()) / 86400000;
            if (ageDays >= TT_REGEN_FREE_DAYS) return 0;
            return Math.ceil(calculateXPForLevel(window.userData.level || 1) * 0.5);
        }

        window.ttRequestRegenerate = function() {
            var tt = ensureTechTree();
            if (tt.pendingRequest) return;
            var cost = ttRegenCost();
            if (cost > 0) {
                var cur = window.userData.currentXP || 0;
                var lvl = window.userData.level || 1;
                var willDemote = cur < cost;
                if (willDemote && lvl <= 1) {
                    // Level 1 with insufficient XP — nothing to demote into.
                    showToast('Not enough XP — regenerate costs ' + cost + ' XP (free in ' +
                        Math.ceil(TT_REGEN_FREE_DAYS - (Date.now() - new Date(tt.lastGeneratedAt).getTime()) / 86400000) + ' days)', 'olive');
                    return;
                }
                var msg = willDemote
                    ? 'Regenerate costs ' + cost + ' XP but you only have ' + cur + ' — paying will drop you back to Level ' + (lvl - 1) + '.\n\nActive nodes are kept; unresolved suggestions are replaced. Continue?'
                    : 'Regenerate now for ' + cost + ' XP (50% of your current level-up)?\n\nActive nodes are kept; unresolved suggestions are replaced.';
                if (!confirm(msg)) return;
                cur -= cost;
                if (cur < 0) {
                    // Demote one level and borrow the shortfall from it
                    window.userData.level = lvl - 1;
                    cur += calculateXPForLevel(lvl - 1);
                    if (cur < 0) cur = 0;
                    showToast('Level ' + (lvl - 1) + ' — spent into the previous level for this regenerate', 'olive');
                }
                window.userData.currentXP = cur;
            } else {
                if (!confirm('Regenerate your Tech Tree?\n\nActive nodes are kept; unresolved suggestions are replaced with a new frontier.')) return;
            }
            ttSubmitRequest({ type: 'regenerate', paidXP: cost });
            updateDashboard();
        };

        function ttRevisionAvailable() {
            var tt = ensureTechTree();
            if (tt.pendingRequest || tt.status !== 'generated') return false;
            if ((tt.revisionsUsedSinceGeneration || 0) >= TT_REVISION_LIMIT) return false;
            return !!(tt.revisionWindowExpiresAt && Date.now() < new Date(tt.revisionWindowExpiresAt).getTime());
        }

        window.ttRequestRevision = function(nodeId) {
            if (!ttRevisionAvailable()) { showToast('Revision window closed (2 per generation, within 24h)', 'olive'); return; }
            var tt = ensureTechTree();
            var node = tt.nodes.find(function(n) { return n.id === nodeId; });
            if (!node || node.kind !== 'suggested') return;
            ttCloseSheet();
            var revLeft = TT_REVISION_LIMIT - (tt.revisionsUsedSinceGeneration || 0);
            window._ttRevisionConfirm = function() {
                var el = document.getElementById('ttRevisionNote');
                var note = (el && el.value || '').trim();
                if (!note) { showToast('Add a line of feedback first', 'olive'); return; }
                ttCloseOverlay();
                ttSubmitRequest({ type: 'revision', note: note, nodeIds: [nodeId] });
            };
            ttShowOverlay(
                '<div class="tt-form">'
                + '<h3 class="tt-form-title">Revise "' + escapeHtml(node.title) + '"</h3>'
                + '<p class="tt-muted">What should be different? Be specific — the AI replaces only this suggestion, guided by your note.</p>'
                + '<textarea id="ttRevisionNote" class="pl-input tt-goal-input" rows="2" maxlength="240" placeholder="e.g. Too vague — suggest one concrete morning habit that pairs with my sleep schedule instead."></textarea>'
                + '<p class="ay-hint">' + revLeft + ' of ' + TT_REVISION_LIMIT + ' revisions left for this generation.</p>'
                + '<div class="tt-form-actions">'
                + '<button class="tt-btn tt-btn-ghost" onclick="ttCloseOverlay()">Cancel</button>'
                + '<button class="tt-btn tt-btn-primary" onclick="window._ttRevisionConfirm && window._ttRevisionConfirm()">Send revision</button>'
                + '</div></div>'
            );
        };

        window.ttCancelPending = function() {
            var tt = ensureTechTree();
            if (!tt.pendingRequest) return;
            tt.pendingRequest = null;
            saveUserData().catch(function() {});
            ttDetachListener();
            renderTechTree();
        };

        // ── Result listener ──────────────────────────────────────────────
        // Firestore pushes the worker's write; no client polling loop.
        var _ttUnsubscribe = null;
        function ttEnsureListener() {
            if (_ttUnsubscribe || !window.currentUser) return;
            var tt = ensureTechTree();
            if (!tt || !tt.pendingRequest) return;
            var ref = doc(db, 'users', window.currentUser.uid);
            _ttUnsubscribe = onSnapshot(ref, function(snap) {
                if (!snap.exists() || snap.metadata.hasPendingWrites) return;
                var remote = snap.data();
                var rt = remote && remote.techTree;
                if (!rt) return;
                var localPending = window.userData && window.userData.techTree && window.userData.techTree.pendingRequest;
                if (localPending && !rt.pendingRequest) {
                    // Worker finished — adopt the server's techTree wholesale.
                    window.userData.techTree = rt;
                    ttDetachListener();
                    if (rt.lastError) {
                        showToast('⚠️ ' + rt.lastError, 'red');
                    } else {
                        showToast('🌳 Your Tech Tree is ready!', 'green');
                    }
                    evaluateTechTreeMastery();
                    ttRenderIfVisible();
                }
            }, function(err) { console.warn('techTree listener error', err); });
        }
        function ttDetachListener() {
            if (_ttUnsubscribe) { try { _ttUnsubscribe(); } catch (e) {} _ttUnsubscribe = null; }
        }

        function ttRenderIfVisible() {
            var panel = document.getElementById('activitiesSubTechTree');
            var tab = document.getElementById('activitiesTab');
            if (panel && tab && tab.classList.contains('active') && panel.style.display !== 'none') {
                renderTechTree();
            }
        }

        // ── Node resolution (spec §5) ────────────────────────────────────

        // Path 1: Accept as new. Opens the standard activity modal pre-filled;
        // ttResolveAcceptedNode() is invoked from saveActivity's create branch.
        window.ttAcceptNode = function(nodeId) {
            ttCloseSheet();
            window._ttAcceptContext = { nodeId: nodeId };
            openActivityModal(null, null, null);
        };

        function ttResolveAcceptedNode(newActivity) {
            var ctx = window._ttAcceptContext;
            window._ttAcceptContext = null;
            if (!ctx) return;
            var tt = ensureTechTree();
            var node = tt.nodes.find(function(n) { return n.id === ctx.nodeId; });
            if (!node) return;
            node.kind = 'existing';
            node.activityId = newActivity.id;
            node.resolvedVia = 'accepted_new';
            node.lifecycle = 'active';
            node.title = newActivity.name;
            if (newActivity.description) node.description = newActivity.description;
            node.suggestedActivity = null;
            evaluateTechTreeMastery();
            showToast('🌱 "' + newActivity.name + '" added to your Tech Tree', 'green');
            setTimeout(ttRenderIfVisible, 100);
        }

        // Path 2: Map to existing — picker over the user's real activities.
        window.ttMapNode = function(nodeId) {
            ttCloseSheet();
            ttOpenActivityPicker({
                title: 'I already do this',
                subtitle: 'Pick the activity that fulfils this node — it keeps its real history and mastery.',
                onPick: function(activityId) { ttFinishMapping(nodeId, activityId); }
            });
        };

        function ttFinishMapping(nodeId, activityId) {
            var tt = ensureTechTree();
            var node = tt.nodes.find(function(n) { return n.id === nodeId; });
            var e = ttFindActivity(activityId);
            if (!node || !e) return;
            node.kind = 'existing';
            node.activityId = activityId;
            node.resolvedVia = 'mapped';
            node.lifecycle = 'active';
            node.title = e.activity.name;           // mapped nodes show the user's own name (spec §15)
            if (e.activity.description) node.description = e.activity.description;
            node.suggestedActivity = null;
            evaluateTechTreeMastery();              // can be instantly mastered
            saveUserData().catch(function() {});
            var prog = ttMasteryProgress(e.activity);
            showToast(prog.mastered ? '⭐ Mapped & already mastered!' : '🔗 Mapped to "' + e.activity.name + '"', 'green');
            renderTechTree();
        }

        // Path 3: Reject — archive, revivable until the next full regenerate.
        window.ttRejectNode = function(nodeId) {
            var tt = ensureTechTree();
            var node = tt.nodes.find(function(n) { return n.id === nodeId; });
            if (!node) return;
            node.lifecycle = 'archived';
            saveUserData().catch(function() {});
            ttCloseSheet();
            renderTechTree();
        };

        window.ttReviveNode = function(nodeId) {
            var tt = ensureTechTree();
            var node = tt.nodes.find(function(n) { return n.id === nodeId; });
            if (!node) return;
            node.lifecycle = ttNodePrereqsMet(node) ? 'available' : 'locked';
            saveUserData().catch(function() {});
            ttCloseSheet();
            renderTechTree();
        };

        // ── Manually add an existing activity (spec §6) ──────────────────
        window.ttOpenAddExisting = function() {
            ttOpenActivityPicker({
                title: 'Add to Tech Tree',
                subtitle: 'Pick an activity to place as a standalone node — the next regenerate can build on it.',
                excludeOnTree: true,
                onPick: function(activityId) { ttAddActivityToTree(activityId); }
            });
        };

        window.ttAddActivityToTree = function(activityId) {
            var tt = ensureTechTree();
            if (tt.nodes.some(function(n) { return n.activityId === activityId; })) {
                showToast('Already on your Tech Tree', 'olive');
                return;
            }
            var e = ttFindActivity(activityId);
            if (!e) return;
            var finish = function() {
                tt.nodes.push({
                    id: 'ttn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
                    kind: 'existing',
                    resolvedVia: 'user_added',
                    activityId: activityId,
                    lifecycle: 'active',
                    dimensionId: e.dim.id,
                    isNexus: false,
                    nexusDimensionIds: [],
                    tier: 1,
                    prerequisites: [],
                    title: e.activity.name,
                    description: e.activity.description || '',
                    suggestedActivity: null,
                    source: 'user',
                    createdAt: new Date().toISOString()
                });
                evaluateTechTreeMastery();
                saveUserData().catch(function() {});
                showToast('🌱 "' + e.activity.name + '" added to your Tech Tree', 'green');
                ttRenderIfVisible();
            };
            if (!e.activity.techTreeMastery) {
                ttOpenMasteryPrompt(e.activity, finish);
            } else {
                finish();
            }
        };

        // ── Fully custom node (spec §10) ─────────────────────────────────
        window.ttOpenCustomNodeForm = function() {
            var dims = (window.userData.dimensions || []).filter(function(d) { return d.id !== 'uncategorized'; });
            var options = '<option value="uncategorized">Uncategorized</option>' + dims.map(function(d) {
                return '<option value="' + d.id + '">' + escapeHtml(d.name) + '</option>';
            }).join('');
            ttShowOverlay(
                '<div class="tt-form">'
                + '<h3 class="tt-form-title">Custom Node</h3>'
                + '<label class="pl-field-label">Title</label>'
                + '<input type="text" id="ttCustomTitle" class="pl-input" placeholder="e.g. Train for a 10k" maxlength="60">'
                + '<label class="pl-field-label" style="margin-top:10px;">Description (optional)</label>'
                + '<input type="text" id="ttCustomDesc" class="pl-input" placeholder="Short description" maxlength="140">'
                + '<label class="pl-field-label" style="margin-top:10px;">Dimension</label>'
                + '<select id="ttCustomDim" class="pl-input ay-select">' + options + '</select>'
                + '<div class="tt-form-actions">'
                + '<button class="tt-btn tt-btn-ghost" onclick="ttCloseOverlay()">Cancel</button>'
                + '<button class="tt-btn tt-btn-primary" onclick="ttSaveCustomNode()">Add Node</button>'
                + '</div></div>'
            );
        };

        window.ttSaveCustomNode = function() {
            var title = (document.getElementById('ttCustomTitle').value || '').trim();
            if (!title) { showToast('Give the node a title', 'olive'); return; }
            var tt = ensureTechTree();
            tt.nodes.push({
                id: 'ttn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
                kind: 'suggested',
                resolvedVia: 'user_custom',
                activityId: null,
                lifecycle: 'available',
                dimensionId: document.getElementById('ttCustomDim').value || 'uncategorized',
                isNexus: false,
                nexusDimensionIds: [],
                tier: 1,
                prerequisites: [],
                title: title,
                description: (document.getElementById('ttCustomDesc').value || '').trim(),
                suggestedActivity: { name: title, description: (document.getElementById('ttCustomDesc').value || '').trim(),
                    baseXP: 10, frequency: 'daily', dimensionId: document.getElementById('ttCustomDim').value || 'uncategorized', suggestedPathId: null },
                source: 'user',
                createdAt: new Date().toISOString()
            });
            saveUserData().catch(function() {});
            ttCloseOverlay();
            renderTechTree();
        };

        // ── Prerequisite editing (spec §10) — non-active nodes only ──────
        window.ttOpenPrereqEditor = function(nodeId) {
            var tt = ensureTechTree();
            var node = tt.nodes.find(function(n) { return n.id === nodeId; });
            if (!node || node.lifecycle === 'active') return;
            ttCloseSheet();
            // Exclude self and anything that transitively depends on this node (no cycles).
            var dependsOn = function(candidate, targetId, guard) {
                guard = guard || {};
                if (guard[candidate.id]) return false;
                guard[candidate.id] = true;
                return (candidate.prerequisites || []).some(function(pr) {
                    if (pr.type !== 'node_mastered') return false;
                    if (pr.nodeId === targetId) return true;
                    var next = tt.nodes.find(function(n) { return n.id === pr.nodeId; });
                    return next ? dependsOn(next, targetId, guard) : false;
                });
            };
            var current = {};
            (node.prerequisites || []).forEach(function(pr) {
                if (pr.type === 'node_mastered') current[pr.nodeId] = true;
            });
            var candidates = tt.nodes.filter(function(n) {
                return n.id !== nodeId && n.lifecycle !== 'archived' && !dependsOn(n, nodeId);
            });
            var rows = candidates.map(function(n) {
                return '<label class="tt-prereq-row">'
                    + '<input type="checkbox" data-ttprereq="' + n.id + '"' + (current[n.id] ? ' checked' : '') + '>'
                    + '<span class="tt-prereq-dot" style="background:' + ttDimHexRaw(n.dimensionId) + ';"></span>'
                    + '<span class="tt-prereq-name">' + escapeHtml(n.title) + '</span>'
                    + (ttNodeIsMastered(n) ? '<span class="tt-gold">' + ttIcon('star', 12) + '</span>' : '')
                    + '</label>';
            }).join('') || '<p class="tt-muted">No other nodes to connect to yet.</p>';
            ttShowOverlay(
                '<div class="tt-form">'
                + '<h3 class="tt-form-title">Prerequisites for "' + escapeHtml(node.title) + '"</h3>'
                + '<p class="tt-muted">This node unlocks once every checked node is mastered. Activity-based prerequisites from generation are kept as-is.</p>'
                + '<div class="tt-prereq-list">' + rows + '</div>'
                + '<div class="tt-form-actions">'
                + '<button class="tt-btn tt-btn-ghost" onclick="ttCloseOverlay()">Cancel</button>'
                + '<button class="tt-btn tt-btn-primary" onclick="ttSavePrereqs(\'' + nodeId + '\')">Save</button>'
                + '</div></div>'
            );
        };

        window.ttSavePrereqs = function(nodeId) {
            var tt = ensureTechTree();
            var node = tt.nodes.find(function(n) { return n.id === nodeId; });
            if (!node) return;
            var kept = (node.prerequisites || []).filter(function(pr) { return pr.type !== 'node_mastered'; });
            document.querySelectorAll('[data-ttprereq]').forEach(function(cb) {
                if (cb.checked) kept.push({ type: 'node_mastered', nodeId: cb.getAttribute('data-ttprereq') });
            });
            node.prerequisites = kept;
            ttRecomputeTiers();
            evaluateTechTreeMastery();
            saveUserData().catch(function() {});
            ttCloseOverlay();
            renderTechTree();
        };

        // ── Shared overlay / picker / mastery prompt ─────────────────────
        function ttShowOverlay(innerHtml) {
            var el = document.getElementById('ttOverlay');
            if (!el) {
                el = document.createElement('div');
                el.id = 'ttOverlay';
                el.className = 'tt-overlay';
                el.addEventListener('click', function(ev) { if (ev.target === el) ttCloseOverlay(); });
                document.body.appendChild(el);
            }
            el.innerHTML = '<div class="tt-overlay-card">' + innerHtml + '</div>';
            el.style.display = 'flex';
        }
        window.ttCloseOverlay = function() {
            var el = document.getElementById('ttOverlay');
            if (el) el.style.display = 'none';
            window._ttPickerOnPick = null;
            window._ttMasteryConfirm = null;
            window._ttRevisionConfirm = null;
            window._ttGoalEditConfirm = null;
        };

        function ttOpenActivityPicker(opts) {
            var tt = ensureTechTree();
            var onTree = {};
            tt.nodes.forEach(function(n) { if (n.activityId) onTree[n.activityId] = true; });
            var entries = ttAllActivities().filter(function(e) {
                return !(opts.excludeOnTree && onTree[e.activity.id]);
            });
            window._ttPickerOnPick = opts.onPick;
            var rows = entries.map(function(e) {
                var prog = ttMasteryProgress(e.activity);
                return '<button class="tt-picker-row" onclick="ttPickerSelect(\'' + e.activity.id + '\')">'
                    + '<span class="tt-prereq-dot" style="background:' + ttDimHexRaw(e.dim.id) + ';"></span>'
                    + '<span class="tt-picker-name">' + escapeHtml(e.activity.name)
                    + (onTree[e.activity.id] ? ' <span class="tt-picker-tag">on tree</span>' : '') + '</span>'
                    + '<span class="tt-picker-meta">' + escapeHtml(e.activity.frequency || '')
                    + (prog.mastered ? ' <span class="tt-gold">' + ttIcon('star', 11) + '</span>' : '') + '</span>'
                    + '</button>';
            }).join('') || '<p class="tt-muted">No activities available.</p>';
            ttShowOverlay(
                '<div class="tt-form">'
                + '<h3 class="tt-form-title">' + escapeHtml(opts.title) + '</h3>'
                + '<p class="tt-muted">' + escapeHtml(opts.subtitle || '') + '</p>'
                + '<div class="tt-picker-list">' + rows + '</div>'
                + '<div class="tt-form-actions"><button class="tt-btn tt-btn-ghost" onclick="ttCloseOverlay()">Cancel</button></div>'
                + '</div>'
            );
        }
        window.ttPickerSelect = function(activityId) {
            var fn = window._ttPickerOnPick;
            ttCloseOverlay();
            var e = ttFindActivity(activityId);
            if (!fn || !e) return;
            // Mapping/adding an activity without a threshold → one-field mastery
            // prompt as part of the action (spec §3), then continue.
            if (!e.activity.techTreeMastery) {
                ttOpenMasteryPrompt(e.activity, function() { fn(activityId); });
            } else {
                fn(activityId);
            }
        };

        function ttOpenMasteryPrompt(activity, onDone) {
            var def = ttMasteryDefaultFor(activity.frequency);
            window._ttMasteryConfirm = function() {
                var count = Math.max(1, parseInt(document.getElementById('ttPromptCount').value) || def.count);
                var winRaw = document.getElementById('ttPromptWindow').value;
                activity.techTreeMastery = { count: count, windowDays: winRaw === '' ? null : Math.max(1, parseInt(winRaw) || 30) };
                ttCloseOverlay();
                onDone();
            };
            ttShowOverlay(
                '<div class="tt-form">'
                + '<h3 class="tt-form-title">Mastery goal for "' + escapeHtml(activity.name) + '"</h3>'
                + '<p class="tt-muted">When reached, this node is permanently mastered on your tree.</p>'
                + '<div class="tt-mastery-row">'
                + '<input type="number" id="ttPromptCount" class="pl-input" min="1" max="999" value="' + def.count + '" style="width:80px;">'
                + '<span class="tt-mastery-sep">completions within</span>'
                + '<input type="number" id="ttPromptWindow" class="pl-input" min="1" max="3650" value="' + (def.windowDays || '') + '" placeholder="∞" style="width:80px;">'
                + '<span class="tt-mastery-sep">days</span>'
                + '</div>'
                + '<p class="ay-hint">Leave days empty for a lifetime count.</p>'
                + '<div class="tt-form-actions">'
                + '<button class="tt-btn tt-btn-ghost" onclick="ttCloseOverlay()">Cancel</button>'
                + '<button class="tt-btn tt-btn-primary" onclick="window._ttMasteryConfirm && window._ttMasteryConfirm()">Confirm</button>'
                + '</div></div>'
            );
        }

        // Adjust the mastery goal on an already-linked, unmastered node.
        window.ttEditMasteryGoal = function(nodeId) {
            var tt = ensureTechTree();
            var node = tt.nodes.find(function(n) { return n.id === nodeId; });
            var e = node && node.activityId ? ttFindActivity(node.activityId) : null;
            if (!e || e.activity.techTreeMasteredAt) return;
            ttCloseSheet();
            ttOpenMasteryPrompt(e.activity, function() {
                evaluateTechTreeMastery();
                saveUserData().catch(function() {});
                renderTechTree();
            });
        };

        // ── Node action sheet ────────────────────────────────────────────
        window.ttOpenNode = function(nodeId) {
            var tt = ensureTechTree();
            var node = tt.nodes.find(function(n) { return n.id === nodeId; });
            if (!node) return;
            var hex = ttDimHexRaw(node.dimensionId);
            var dimLabel = node.isNexus && (node.nexusDimensionIds || []).length
                ? node.nexusDimensionIds.map(ttDimName).join(' × ')
                : ttDimName(node.dimensionId);
            var e = node.activityId ? ttFindActivity(node.activityId) : null;
            var body = '';

            var stateChip = { locked: 'Locked', available: 'Available', active: 'In progress', archived: 'Archived' }[node.lifecycle] || node.lifecycle;
            if (node.lifecycle === 'active' && ttNodeIsMastered(node)) stateChip = 'Mastered';

            body += '<div class="tt-sheet-head" style="--tt-dim:' + hex + ';">'
                + '<div class="tt-sheet-bar"></div>'
                + '<div class="tt-sheet-titles">'
                + '<div class="tt-sheet-title">' + escapeHtml(node.title) + '</div>'
                + '<div class="tt-sheet-sub">' + escapeHtml(dimLabel) + ' · Tier ' + (node.tier || 1) + ' · ' + stateChip + '</div>'
                + '</div></div>';
            if (node.description) body += '<p class="tt-sheet-desc">' + escapeHtml(node.description) + '</p>';

            if (node.lifecycle === 'active' && e) {
                var prog = ttMasteryProgress(e.activity);
                var windowLabel = prog.windowDays ? 'last ' + prog.windowDays + ' days' : 'lifetime';
                body += '<div class="tt-sheet-progress">'
                    + '<div class="tt-sheet-progress-label">Mastery' + (prog.mastered
                        ? ' <span class="tt-gold">' + ttIcon('star', 11) + ' achieved</span>'
                        : ' — <span class="tt-num">' + prog.count + ' / ' + prog.target + '</span> completions (' + windowLabel + ')') + '</div>'
                    + '<div class="tt-progressbar"><div class="tt-progressbar-fill" style="width:' + Math.round(prog.pct * 100) + '%;background:' + hex + ';"></div></div>'
                    + '</div>';
            }

            if ((node.prerequisites || []).length) {
                body += '<div class="tt-sheet-prereqs"><div class="tt-sheet-progress-label">Prerequisites</div>'
                    + node.prerequisites.map(function(pr) {
                        var label, met;
                        if (pr.type === 'node_mastered') {
                            var target = tt.nodes.find(function(n) { return n.id === pr.nodeId; });
                            label = target ? target.title : '(removed node)';
                            met = target ? ttNodeIsMastered(target) : true;
                        } else {
                            var pe = ttFindActivity(pr.activityId);
                            label = pe ? pe.activity.name : '(removed activity)';
                            met = pe ? !!pe.activity.techTreeMasteredAt : true;
                        }
                        return '<div class="tt-sheet-prereq' + (met ? ' met' : '') + '">'
                            + (met ? ttIcon('check', 12) : ttIcon('circle', 11)) + ' ' + escapeHtml(label) + '</div>';
                    }).join('') + '</div>';
            }

            function btn(cls, action, icon, label) {
                return '<button class="tt-btn' + (cls ? ' ' + cls : '') + '" onclick="' + action + '(\'' + node.id + '\')">'
                    + ttIcon(icon) + '<span>' + label + '</span></button>';
            }
            var actions = '';
            if (node.lifecycle === 'available' && node.kind === 'suggested') {
                actions += btn('tt-btn-primary', 'ttAcceptNode', 'plus', 'Accept as new activity');
                actions += btn('', 'ttMapNode', 'link', 'I already do this');
                if (ttRevisionAvailable() && node.source === 'ai') {
                    actions += btn('', 'ttRequestRevision', 'edit', 'Request revision');
                }
                actions += btn('tt-btn-ghost', 'ttRejectNode', 'archive', 'Not now');
            } else if (node.lifecycle === 'locked') {
                if (ttRevisionAvailable() && node.source === 'ai') {
                    actions += btn('', 'ttRequestRevision', 'edit', 'Request revision');
                }
                actions += btn('tt-btn-ghost', 'ttRejectNode', 'archive', 'Not now');
            } else if (node.lifecycle === 'archived') {
                actions += btn('tt-btn-primary', 'ttReviveNode', 'revive', 'Revive');
            } else if (node.lifecycle === 'active' && e && !e.activity.techTreeMasteredAt) {
                actions += btn('', 'ttEditMasteryGoal', 'target', 'Edit mastery goal');
            }
            if (node.lifecycle !== 'active' && node.lifecycle !== 'archived') {
                actions += btn('tt-btn-ghost', 'ttOpenPrereqEditor', 'branch', 'Edit prerequisites');
            }
            body += '<div class="tt-sheet-actions">' + actions + '</div>';

            var el = document.getElementById('ttNodeSheet');
            if (!el) {
                el = document.createElement('div');
                el.id = 'ttNodeSheet';
                el.className = 'tt-sheet-backdrop';
                el.addEventListener('click', function(ev) { if (ev.target === el) ttCloseSheet(); });
                document.body.appendChild(el);
            }
            el.innerHTML = '<div class="tt-sheet">' + body + '</div>';
            el.style.display = 'flex';
        };
        window.ttCloseSheet = function() {
            var el = document.getElementById('ttNodeSheet');
            if (el) el.style.display = 'none';
        };

        // ── Horizontal layout ────────────────────────────────────────────
        // Left-to-right skill tree: columns are tiers (unlock order reads as
        // time flowing right), horizontal lanes are dimensions. Crowded trees
        // grow taller/wider — the canvas pans and zooms, so size is free.
        function ttComputeLayout(showArchived) {
            var tt = ensureTechTree();
            var nodes = tt.nodes.filter(function(n) { return showArchived || n.lifecycle !== 'archived'; });
            var dims = window.userData.dimensions || [];
            var COL_W = 172;    // horizontal distance between tiers
            var ROW_H = 92;     // vertical distance between nodes in a column
            var LANE_PAD = 34;  // breathing room inside each dimension lane
            var LANE_X = 64;    // where lanes begin (left of tier 1)
            var TIER1_X = 176;  // x of tier 1 column

            var usedDimIds = [];
            nodes.forEach(function(n) {
                var id = n.dimensionId || 'uncategorized';
                if (usedDimIds.indexOf(id) === -1) usedDimIds.push(id);
            });
            usedDimIds.sort(function(a, b) {
                var ia = dims.findIndex(function(d) { return d.id === a; });
                var ib = dims.findIndex(function(d) { return d.id === b; });
                return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
            });

            var maxTier = 1;
            nodes.forEach(function(nd) { maxTier = Math.max(maxTier, nd.tier || 1); });

            // Rows per lane per tier (nexus nodes live in their primary lane)
            var rows = {};
            usedDimIds.forEach(function(dimId) {
                rows[dimId] = {};
                for (var t = 1; t <= maxTier; t++) rows[dimId][t] = [];
            });
            nodes.forEach(function(nd) {
                var dimId = rows[nd.dimensionId] ? nd.dimensionId : usedDimIds[0];
                rows[dimId][nd.tier || 1].push(nd);
            });

            var tierXs = {};
            for (var t = 1; t <= maxTier; t++) tierXs[t] = TIER1_X + (t - 1) * COL_W;

            var lanes = [];
            var pos = {};
            var cursorY = 0;
            usedDimIds.forEach(function(dimId) {
                var laneRows = 1;
                for (var t = 1; t <= maxTier; t++) laneRows = Math.max(laneRows, rows[dimId][t].length);
                var laneHeight = laneRows * ROW_H + LANE_PAD;
                for (var t2 = 1; t2 <= maxTier; t2++) {
                    var group = rows[dimId][t2];
                    // center a short column vertically within the lane
                    var offset = (laneRows - group.length) * ROW_H / 2;
                    group.forEach(function(nd, i) {
                        pos[nd.id] = {
                            x: tierXs[t2],
                            y: cursorY + LANE_PAD / 2 + offset + (i + 0.5) * ROW_H
                        };
                    });
                }
                lanes.push({ dimId: dimId, top: cursorY, height: laneHeight });
                cursorY += laneHeight;
            });

            var totalH = Math.max(cursorY, 200);
            return {
                nodes: nodes, lanes: lanes, positions: pos, tierXs: tierXs, maxTier: maxTier,
                laneX: LANE_X, coreX: 36, coreY: totalH / 2, coreR: 34,
                width: TIER1_X + (maxTier - 1) * COL_W + 130,
                height: totalH
            };
        }

        function ttBuildTreeSVG(showArchived, interactive) {
            var layout = ttComputeLayout(showArchived);
            var tt = ensureTechTree();
            var NR = 20; // node radius
            var CIRC = 2 * Math.PI * NR;
            var svg = '';

            // Shared defs: core gradient. Duplicate ids across the preview and
            // fullscreen SVGs are fine — they resolve identically.
            svg += '<defs>'
                + '<radialGradient id="ttCoreGrad">'
                + '<stop offset="0%" stop-color="rgba(90,159,212,0.45)"/>'
                + '<stop offset="70%" stop-color="rgba(90,159,212,0.12)"/>'
                + '<stop offset="100%" stop-color="rgba(90,159,212,0.03)"/>'
                + '</radialGradient>'
                + '</defs>';

            // Dimension lanes — tinted horizontal bands with a glowing left
            // accent and the dimension name ("tint, don't fill").
            layout.lanes.forEach(function(lane) {
                var hex = ttDimHexRaw(lane.dimId);
                var y0 = lane.top + 3, h = lane.height - 6;
                svg += '<rect x="' + layout.laneX + '" y="' + y0 + '" width="' + (layout.width - layout.laneX) + '" height="' + h
                    + '" rx="12" fill="' + hex + '" opacity="0.045"/>';
                svg += '<rect x="' + layout.laneX + '" y="' + y0 + '" width="3" height="' + h + '" rx="1.5" fill="' + hex + '" opacity="0.7"/>';
                svg += '<text x="' + (layout.laneX + 12) + '" y="' + (y0 + 16) + '" class="tt-svg-sector-label" fill="' + hex + '">'
                    + escapeHtml(ttDimName(lane.dimId)) + '</text>';
            });

            // Tier column guides + labels
            for (var t = 1; t <= layout.maxTier; t++) {
                var tx = layout.tierXs[t];
                svg += '<line x1="' + tx + '" y1="-6" x2="' + tx + '" y2="' + layout.height
                    + '" stroke="rgba(150,150,170,0.06)" stroke-width="1"/>';
                svg += '<text x="' + tx + '" y="-16" text-anchor="middle" class="tt-svg-tier-label">TIER ' + t + '</text>';
            }

            // Edges — horizontal S-curves with a chevron pointing at the node
            // they unlock. Solid + dimension-colored once the source is
            // mastered; a quiet dashed hairline while the dependency is open.
            function cAt(a, c1, c2, b, t) {
                var mt = 1 - t;
                return {
                    x: mt * mt * mt * a.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * b.x,
                    y: mt * mt * mt * a.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * b.y
                };
            }
            function cTan(a, c1, c2, b, t) {
                var mt = 1 - t;
                return {
                    x: 3 * mt * mt * (c1.x - a.x) + 6 * mt * t * (c2.x - c1.x) + 3 * t * t * (b.x - c2.x),
                    y: 3 * mt * mt * (c1.y - a.y) + 6 * mt * t * (c2.y - c1.y) + 3 * t * t * (b.y - c2.y)
                };
            }
            var drawnEdges = {};
            function edge(fromId, toId) {
                var key = fromId + '>' + toId;
                if (drawnEdges[key]) return;
                drawnEdges[key] = true;
                var a = layout.positions[fromId], b = layout.positions[toId];
                if (!a || !b) return;
                var from = tt.nodes.find(function(n) { return n.id === fromId; });
                var met = from ? ttNodeIsMastered(from) : false;
                var hex = ttDimHexRaw(from && from.dimensionId);
                var stroke = met ? hex : 'rgba(150,150,160,0.28)';
                var bend = Math.max(36, Math.abs(b.x - a.x) * 0.45);
                var c1 = { x: a.x + bend, y: a.y };
                var c2 = { x: b.x - bend, y: b.y };
                svg += '<path d="M' + a.x.toFixed(1) + ',' + a.y.toFixed(1)
                    + ' C' + c1.x.toFixed(1) + ',' + c1.y.toFixed(1)
                    + ' ' + c2.x.toFixed(1) + ',' + c2.y.toFixed(1)
                    + ' ' + b.x.toFixed(1) + ',' + b.y.toFixed(1)
                    + '" fill="none" stroke="' + stroke + '"'
                    + ' stroke-width="' + (met ? 2 : 1.5) + '"'
                    + (met ? ' opacity="0.8"' : ' stroke-dasharray="3,6" stroke-linecap="round"') + '/>';
                var pt = cAt(a, c1, c2, b, 0.8);
                var tg = cTan(a, c1, c2, b, 0.8);
                var deg = Math.atan2(tg.y, tg.x) * 180 / Math.PI;
                svg += '<g transform="translate(' + pt.x.toFixed(1) + ',' + pt.y.toFixed(1) + ') rotate(' + deg.toFixed(1) + ')">'
                    + '<path d="M-4.5,-3.5 L2.5,0 L-4.5,3.5" fill="none" stroke="' + stroke + '"'
                    + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
                    + (met ? ' opacity="0.9"' : ' opacity="0.7"') + '/></g>';
            }
            var nodeByActivity = {};
            layout.nodes.forEach(function(n) { if (n.activityId) nodeByActivity[n.activityId] = n.id; });
            layout.nodes.forEach(function(n) {
                (n.prerequisites || []).forEach(function(pr) {
                    if (pr.type === 'node_mastered') edge(pr.nodeId, n.id);
                    else if (pr.type === 'activity_mastered' && nodeByActivity[pr.activityId]) edge(nodeByActivity[pr.activityId], n.id);
                });
            });
            (tt.connections || []).forEach(function(c) { edge(c.fromNodeId, c.toNodeId); });

            // Core — anchors the tree at the left
            svg += '<circle cx="' + layout.coreX + '" cy="' + layout.coreY.toFixed(1) + '" r="' + (layout.coreR + 24) + '" fill="url(#ttCoreGrad)"/>'
                + '<circle cx="' + layout.coreX + '" cy="' + layout.coreY.toFixed(1) + '" r="' + layout.coreR + '" class="tt-svg-core"/>'
                + '<text x="' + layout.coreX + '" y="' + (layout.coreY - 3).toFixed(1) + '" class="tt-svg-core-label" text-anchor="middle">Lv ' + (window.userData.level || 1) + '</text>'
                + '<text x="' + layout.coreX + '" y="' + (layout.coreY + 12).toFixed(1) + '" class="tt-svg-core-sub" text-anchor="middle">YOU</text>';

            // Small stroked glyphs drawn in SVG (no emoji — design brief)
            function glyphLock(color) {
                return '<g stroke="' + color + '" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round">'
                    + '<rect x="-5" y="-1" width="10" height="8" rx="1.6"/>'
                    + '<path d="M-3 -1 v-2.4 a3 3 0 0 1 6 0 V-1"/></g>';
            }
            function glyphStar(color) {
                return '<path fill="' + color + '" transform="scale(0.62) translate(0,1)" d="M0,-10 L2.9,-3.5 10,-2.6 4.7,2.2 6.1,9.3 0,5.8 -6.1,9.3 -4.7,2.2 -10,-2.6 -2.9,-3.5 Z"/>';
            }
            function glyphPlus(color) {
                return '<g stroke="' + color + '" stroke-width="2.2" stroke-linecap="round">'
                    + '<line x1="-5" y1="0" x2="5" y2="0"/><line x1="0" y1="-5" x2="0" y2="5"/></g>';
            }
            function glyphArchive(color) {
                return '<g stroke="' + color + '" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round">'
                    + '<rect x="-6" y="-5" width="12" height="4" rx="1"/>'
                    + '<path d="M-5 -1 v6.5 h10 V-1"/><line x1="-2" y1="2.4" x2="2" y2="2.4"/></g>';
            }

            // Nodes — every state carries its dimension color; mastery is a
            // proportional ring fill from grey (0%) to full color (100%),
            // and a fully mastered node collapses into a small gold star.
            layout.nodes.forEach(function(n) {
                var p = layout.positions[n.id];
                if (!p) return;
                var hex = ttDimHexRaw(n.dimensionId);
                var rgb = _dimRgb(hex);
                var e = n.activityId ? ttFindActivity(n.activityId) : null;
                var prog = e ? ttMasteryProgress(e.activity) : { pct: 0, mastered: false };
                var isMastered = n.lifecycle === 'active' && prog.mastered;
                var cls = 'tt-svg-node tt-' + n.lifecycle + (n.isNexus ? ' tt-nexus' : '') + (isMastered ? ' tt-mastered' : '');
                var click = interactive ? ' onclick="ttOpenNode(\'' + n.id + '\')"' : '';
                svg += '<g class="' + cls + '" transform="translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')"' + click + ' style="cursor:pointer;">';

                if (isMastered) {
                    svg += '<circle r="16" fill="rgba(245,197,99,0.07)"/>'
                        + '<circle r="10" fill="rgba(245,197,99,0.13)"/>'
                        + '<circle r="7" fill="rgba(' + rgb + ',0.9)"/>'
                        + '<g transform="scale(0.78)">' + glyphStar('#f5c563') + '</g>';
                    if (n.isNexus) {
                        svg += '<circle r="12.5" fill="none" stroke="' + hex + '" stroke-width="1" stroke-dasharray="2,4" opacity="0.8"/>';
                    }
                    var slabel = n.title.length > 16 ? n.title.slice(0, 15) + '…' : n.title;
                    svg += '<text y="24" text-anchor="middle" class="tt-svg-label-star">' + escapeHtml(slabel) + '</text>';
                    svg += '</g>';
                    return;
                }

                if (n.lifecycle === 'active' || n.lifecycle === 'available') {
                    svg += '<circle r="' + (NR + 8) + '" fill="rgba(' + rgb + ',0.07)"/>';
                }

                var baseFill = n.lifecycle === 'archived' ? 'rgba(' + rgb + ',0.06)'
                    : n.lifecycle === 'active' ? 'rgba(' + rgb + ',' + (0.10 + prog.pct * 0.45).toFixed(2) + ')'
                    : n.lifecycle === 'available' ? 'rgba(' + rgb + ',0.15)'
                    : 'rgba(' + rgb + ',0.07)';
                svg += '<circle r="' + NR + '" fill="' + baseFill + '"/>';

                if (n.lifecycle === 'active') {
                    svg += '<circle r="' + NR + '" fill="none" stroke="rgba(150,150,160,0.25)" stroke-width="3"/>';
                    if (prog.pct > 0) {
                        svg += '<circle r="' + NR + '" fill="none" stroke="' + hex + '" stroke-width="3" stroke-linecap="round"'
                            + ' stroke-dasharray="' + (CIRC * prog.pct).toFixed(1) + ' ' + CIRC.toFixed(1) + '"'
                            + ' transform="rotate(-90)"/>';
                    }
                } else if (n.lifecycle === 'available') {
                    svg += '<circle r="' + NR + '" fill="none" stroke="' + hex + '" stroke-width="2.4" class="tt-svg-avail-ring"/>';
                } else if (n.lifecycle === 'locked') {
                    svg += '<circle r="' + NR + '" fill="none" stroke="rgba(' + rgb + ',0.4)" stroke-width="2" stroke-dasharray="3,5"/>';
                } else {
                    svg += '<circle r="' + NR + '" fill="none" stroke="rgba(150,150,160,0.3)" stroke-width="1.6" stroke-dasharray="3,5"/>';
                }
                if (n.isNexus) {
                    svg += '<circle r="' + (NR + 4.5) + '" fill="none" stroke="' + hex + '" stroke-width="1.1" stroke-dasharray="2,4" opacity="0.8"/>';
                }

                if (n.lifecycle === 'active') svg += '<text y="4.5" text-anchor="middle" class="tt-svg-pct">' + Math.round(prog.pct * 100) + '%</text>';
                else if (n.lifecycle === 'available') svg += glyphPlus(hex);
                else if (n.lifecycle === 'locked') svg += glyphLock('rgba(' + rgb + ',0.75)');
                else if (n.lifecycle === 'archived') svg += glyphArchive('rgba(150,150,160,0.7)');

                var label = n.title.length > 16 ? n.title.slice(0, 15) + '…' : n.title;
                svg += '<text y="' + (NR + 13) + '" text-anchor="middle" class="tt-svg-label'
                    + (n.lifecycle === 'locked' || n.lifecycle === 'archived' ? ' tt-svg-label-dim' : '') + '">'
                    + escapeHtml(label) + '</text>';
                svg += '</g>';
            });

            var minX = -14, minY = -40;
            var vbW = layout.width - minX + 20;
            var vbH = layout.height - minY + 24;
            // Natural (1:1) width/height so the preview renders zoomed-in and
            // scrolls both axes instead of squeezing the whole tree into the
            // card. The fullscreen canvas overrides these via CSS and pans.
            return '<svg class="tt-svg" width="' + vbW + '" height="' + vbH + '" viewBox="' + minX + ' ' + minY + ' ' + vbW + ' ' + vbH + '" xmlns="http://www.w3.org/2000/svg">' + svg + '</svg>';
        }

        // ── Fullscreen pan/zoom canvas ───────────────────────────────────
        window.ttOpenFullscreen = function() {
            var el = document.getElementById('ttFullscreen');
            if (!el) {
                el = document.createElement('div');
                el.id = 'ttFullscreen';
                el.className = 'tt-fullscreen';
                document.body.appendChild(el);
            }
            el.innerHTML =
                '<div class="tt-fullscreen-bar">'
                + '<span class="tt-fullscreen-title">Tech Tree</span>'
                + '<span class="tt-fullscreen-hint">drag to pan · pinch/scroll to zoom</span>'
                + '<button class="tt-btn tt-btn-ghost" onclick="ttCloseFullscreen()">' + ttIcon('x', 12) + '<span>Close</span></button>'
                + '</div>'
                + '<div class="tt-fullscreen-canvas" id="ttFsCanvas">' + ttBuildTreeSVG(window._ttShowArchived, true) + '</div>';
            el.style.display = 'flex';
            ttInitPanZoom(document.getElementById('ttFsCanvas'));
        };
        window.ttCloseFullscreen = function() {
            var el = document.getElementById('ttFullscreen');
            if (el) el.style.display = 'none';
        };

        function ttInitPanZoom(container) {
            var svg = container && container.querySelector('svg');
            if (!svg) return;
            var full = svg.getAttribute('viewBox').split(' ').map(Number);
            var rect0 = container.getBoundingClientRect();
            var aspect = rect0.height / Math.max(1, rect0.width); // match the screen, not the tree
            // Open zoomed-in at ~1:1 (one SVG unit ≈ one CSS pixel), anchored
            // at the left edge and vertically centered on the core — pan for
            // lanes/tiers, zoom out for the overview.
            var vb = { w: Math.min(full[2], rect0.width), h: 0, x: full[0], y: 0 };
            vb.h = vb.w * aspect;
            vb.y = (full[1] + full[3] / 2) - vb.h / 2;
            var minW = Math.max(160, rect0.width * 0.35);
            var maxW = full[2] * 1.25;
            var pointers = {};
            var lastPinchDist = null;
            var moved = false;

            function apply() { svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h); }
            apply();
            function scaleAt(factor, cx, cy) {
                var newW = Math.min(maxW, Math.max(minW, vb.w * factor));
                var ratio = newW / vb.w;
                var rect = container.getBoundingClientRect();
                var px = vb.x + (cx - rect.left) / rect.width * vb.w;
                var py = vb.y + (cy - rect.top) / rect.height * vb.h;
                vb.x = px - (px - vb.x) * ratio;
                vb.y = py - (py - vb.y) * ratio;
                vb.w = newW; vb.h = newW * aspect;
                apply();
            }

            container.addEventListener('pointerdown', function(ev) {
                pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
                moved = false;
                container.setPointerCapture(ev.pointerId);
            });
            container.addEventListener('pointermove', function(ev) {
                if (!pointers[ev.pointerId]) return;
                var ids = Object.keys(pointers);
                var rect = container.getBoundingClientRect();
                if (ids.length === 1) {
                    var dx = ev.clientX - pointers[ev.pointerId].x;
                    var dy = ev.clientY - pointers[ev.pointerId].y;
                    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
                    vb.x -= dx / rect.width * vb.w;
                    vb.y -= dy / rect.height * vb.h;
                    apply();
                } else if (ids.length === 2) {
                    pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
                    var a = pointers[ids[0]], b = pointers[ids[1]];
                    var dist = Math.hypot(a.x - b.x, a.y - b.y);
                    if (lastPinchDist) {
                        moved = true;
                        scaleAt(lastPinchDist / dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
                    }
                    lastPinchDist = dist;
                    return;
                }
                pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
            });
            function up(ev) {
                delete pointers[ev.pointerId];
                if (Object.keys(pointers).length < 2) lastPinchDist = null;
            }
            container.addEventListener('pointerup', up);
            container.addEventListener('pointercancel', up);
            // Suppress node click after a real drag
            container.addEventListener('click', function(ev) {
                if (moved) { ev.stopPropagation(); ev.preventDefault(); moved = false; }
            }, true);
            container.addEventListener('wheel', function(ev) {
                ev.preventDefault();
                scaleAt(ev.deltaY > 0 ? 1.12 : 0.89, ev.clientX, ev.clientY);
            }, { passive: false });
        }

        // ── Main renderer ────────────────────────────────────────────────
        window._ttShowArchived = false;
        window.ttToggleArchived = function() {
            window._ttShowArchived = !window._ttShowArchived;
            renderTechTree();
        };

        function renderTechTree() {
            var container = document.getElementById('techTreeContainer');
            if (!container || !window.userData) return;
            var tt = ensureTechTree();
            if (evaluateTechTreeMastery()) debouncedSaveUserData();

            // ── Building state ────────────────────────────────────────────
            if (tt.pendingRequest) {
                ttEnsureListener();
                var typeLabel = { generate: 'Building your tree', regenerate: 'Regenerating your tree', revision: 'Revising your tree' }[tt.pendingRequest.type] || 'Working';
                container.innerHTML =
                    '<div class="tt-card tt-building">'
                    + '<div class="tt-building-spinner"></div>'
                    + '<h2 class="tt-title">' + typeLabel + '…</h2>'
                    + '<p class="tt-muted">Your request is queued for the next generation cycle. This usually takes <strong>5–15 minutes</strong> — you can leave this screen; the tree appears automatically when ready.</p>'
                    + '<button class="tt-btn tt-btn-ghost" onclick="ttCancelPending()">' + ttIcon('x', 12) + '<span>Cancel request</span></button>'
                    + '</div>';
                return;
            }

            // ── Empty / gate state (spec §2) — onboarding empty: CTA + copy ──
            if (tt.status !== 'generated' || !tt.nodes.length) {
                var gate = ttGateStatus();
                var actOk = gate.activityCount >= 3;
                container.innerHTML =
                    '<div class="tt-card">'
                    + '<h2 class="tt-title">Character Tech Tree</h2>'
                    + '<p class="tt-muted">State your goal and the AI proposes a personalized path toward it — a tree of new activities that unlock and master as you complete them, built on top of what you already do.</p>'
                    + (tt.lastError ? '<div class="tt-error">' + escapeHtml(tt.lastError) + '</div>' : '')
                    + '<label class="pl-field-label" style="margin-top:14px;">Your goal</label>'
                    + '<textarea id="ttGoalInput" class="pl-input tt-goal-input" rows="3" maxlength="500" placeholder="e.g. Run a half-marathon by next summer while keeping my study routine">' + escapeHtml(tt.goalText || '') + '</textarea>'
                    + '<button class="tt-btn tt-btn-ghost" style="margin-top:8px;" onclick="ttSaveGoal()">Save goal</button>'
                    + '<div class="tt-gate">'
                    + '<div class="tt-gate-item' + (actOk ? ' met' : '') + '">' + ttIcon(actOk ? 'check' : 'circle', 12)
                    + '<span><span class="tt-num">' + Math.min(gate.activityCount, 3) + '/3</span> activities</span></div>'
                    + '<div class="tt-gate-item' + (gate.hasGoal ? ' met' : '') + '">' + ttIcon(gate.hasGoal ? 'check' : 'circle', 12)
                    + '<span>goal ' + (gate.hasGoal ? 'set' : 'not set') + '</span></div>'
                    + '</div>'
                    + '<button class="tt-btn tt-btn-primary tt-generate-btn" ' + (gate.met ? '' : 'disabled ') + 'onclick="ttRequestGenerate()">'
                    + ttIcon('branch') + '<span>Generate Character Tree</span></button>'
                    + (gate.met ? '' : '<p class="ay-hint" style="text-align:center;">Unlocks with 3+ activities and a saved goal</p>')
                    + '</div>';
                return;
            }

            // ── Tree state ────────────────────────────────────────────────
            var cost = ttRegenCost();
            var revLeft = Math.max(0, TT_REVISION_LIMIT - (tt.revisionsUsedSinceGeneration || 0));
            var revOpen = ttRevisionAvailable();
            var archivedCount = tt.nodes.filter(function(n) { return n.lifecycle === 'archived'; }).length;

            var html = '<div class="tt-toolbar">'
                + '<button class="tt-tb-btn" onclick="ttOpenAddExisting()">' + ttIcon('plus', 12) + '<span>Add existing</span></button>'
                + '<button class="tt-tb-btn" onclick="ttOpenCustomNodeForm()">' + ttIcon('edit', 12) + '<span>Custom node</span></button>'
                + '<button class="tt-tb-btn" onclick="ttRequestRegenerate()">' + ttIcon('refresh', 12)
                + '<span>Regenerate' + (cost > 0 ? ' · <span class="tt-num">' + cost + '</span> XP' : ' · free') + '</span></button>'
                + (archivedCount ? '<button class="tt-tb-btn" onclick="ttToggleArchived()">' + ttIcon('archive', 12)
                    + '<span>' + (window._ttShowArchived ? 'Hide' : 'Show') + ' archived (' + archivedCount + ')</span></button>' : '')
                + '</div>';

            html += '<div class="tt-goal-bar">'
                + ttIcon('target', 13)
                + '<span class="tt-goal-text">' + escapeHtml(tt.goalText || 'No goal set') + '</span>'
                + '<button class="tt-goal-edit" onclick="ttStartGoalEdit()">Edit</button>'
                + '</div>';
            // The snapshot of the future this tree leads to — written by the
            // generation pass, shown quietly above the canvas.
            if (tt.vision) {
                html += '<div class="tt-vision">'
                    + '<div class="tt-vision-kicker">Where this leads</div>'
                    + '<div class="tt-vision-text">' + escapeHtml(tt.vision) + '</div>'
                    + '</div>';
            }
            if (revOpen) {
                html += '<p class="tt-rev-note"><span class="tt-num">' + revLeft + '</span> revision' + (revLeft === 1 ? '' : 's') + ' left — tap a suggested node to request a targeted fix (24h window).</p>';
            }

            html += '<div class="tt-canvas-preview" onclick="ttOpenFullscreen()">'
                + ttBuildTreeSVG(window._ttShowArchived, false)
                + '<div class="tt-canvas-expand">' + ttIcon('expand', 11) + '<span>Tap to explore</span></div>'
                + '</div>';

            // AI-suggested milestone challenges — one-click add into the
            // Challenges tab. Only shown once that tab is unlocked.
            var suggCh = (tt.suggestedChallenges || []).filter(function(c) { return c.status === 'suggested'; });
            if (suggCh.length && (typeof isTabUnlocked !== 'function' || isTabUnlocked('challenges'))) {
                html += '<div class="tt-group"><div class="tt-group-label">Suggested challenges</div>'
                    + suggCh.map(function(c) {
                        var ids = Object.keys(c.activityTargets || {});
                        var names = ids.map(function(id) {
                            var e = ttFindActivity(id);
                            return e ? e.activity.name : null;
                        }).filter(Boolean);
                        var total = ids.reduce(function(s, id) { return s + (c.activityTargets[id] || 0); }, 0);
                        return '<div class="tt-challenge-card">'
                            + '<div class="tt-challenge-main">'
                            + '<div class="tt-challenge-title">' + escapeHtml(c.title) + '</div>'
                            + (c.description ? '<div class="tt-challenge-desc">' + escapeHtml(c.description) + '</div>' : '')
                            + '<div class="tt-challenge-meta"><span class="tt-num">' + total + '</span> completions · <span class="tt-num">'
                            + c.durationDays + '</span> days · ' + escapeHtml(names.join(', ')) + '</div>'
                            + '</div>'
                            + '<div class="tt-challenge-actions">'
                            + '<button class="tt-ch-add" onclick="ttAcceptChallenge(\'' + c.id + '\')">' + ttIcon('plus', 12) + '<span>Add</span></button>'
                            + '<button class="tt-ch-dismiss" onclick="ttDismissChallenge(\'' + c.id + '\')" aria-label="Dismiss">' + ttIcon('x', 11) + '</button>'
                            + '</div></div>';
                    }).join('') + '</div>';
            }

            // Node list — grouped, tappable rows mirroring the canvas.
            // Left-edge dimension bar per the brief's dimension color treatment.
            function nodeRow(n) {
                var hex = ttDimHexRaw(n.dimensionId);
                var e = n.activityId ? ttFindActivity(n.activityId) : null;
                var prog = e ? ttMasteryProgress(e.activity) : null;
                var right = '';
                if (n.lifecycle === 'active' && prog) {
                    right = prog.mastered
                        ? '<span class="tt-gold">' + ttIcon('star', 13) + '</span>'
                        : '<span class="tt-num tt-row-pct">' + Math.round(prog.pct * 100) + '%</span>';
                } else if (n.lifecycle === 'locked') right = ttIcon('lock', 12);
                else if (n.lifecycle === 'available') right = '<span class="tt-blue">' + ttIcon('spark', 13) + '</span>';
                else if (n.lifecycle === 'archived') right = ttIcon('archive', 12);
                return '<button class="tt-node-row" style="--tt-dim:' + hex + ';--tt-dim-rgb:' + _dimRgb(hex) + ';" onclick="ttOpenNode(\'' + n.id + '\')">'
                    + '<span class="tt-node-row-title">' + escapeHtml(n.title) + (n.isNexus ? ' <span class="tt-nexus-tag">nexus</span>' : '') + '</span>'
                    + '<span class="tt-node-row-right">' + right + '</span>'
                    + '</button>';
            }
            var groups = [
                { label: 'Available', match: function(n) { return n.lifecycle === 'available'; } },
                { label: 'In progress', match: function(n) { return n.lifecycle === 'active' && !ttNodeIsMastered(n); } },
                { label: 'Mastered', match: function(n) { return n.lifecycle === 'active' && ttNodeIsMastered(n); } },
                { label: 'Locked', match: function(n) { return n.lifecycle === 'locked'; } },
            ];
            if (window._ttShowArchived) groups.push({ label: 'Archived', match: function(n) { return n.lifecycle === 'archived'; } });
            groups.forEach(function(g) {
                var list = tt.nodes.filter(g.match);
                if (!list.length) return;
                html += '<div class="tt-group"><div class="tt-group-label">' + g.label + '</div>' + list.map(nodeRow).join('') + '</div>';
            });

            container.innerHTML = html;
        }
        window.renderTechTree = renderTechTree;

        window.ttStartGoalEdit = function() {
            var tt = ensureTechTree();
            window._ttGoalEditConfirm = function() {
                var el = document.getElementById('ttGoalEditInput');
                if (!el) return;
                tt.goalText = el.value.trim();
                tt.goalTextUpdatedAt = new Date().toISOString();
                saveUserData().catch(function() {});
                ttCloseOverlay();
                showToast('🎯 Goal updated — it informs the next generation', 'blue');
                renderTechTree();
            };
            ttShowOverlay(
                '<div class="tt-form">'
                + '<h3 class="tt-form-title">Your goal</h3>'
                + '<textarea id="ttGoalEditInput" class="pl-input tt-goal-input" rows="3" maxlength="500">' + escapeHtml(tt.goalText || '') + '</textarea>'
                + '<p class="ay-hint">Changing the goal affects future generations only — your current tree stays as-is.</p>'
                + '<div class="tt-form-actions">'
                + '<button class="tt-btn tt-btn-ghost" onclick="ttCloseOverlay()">Cancel</button>'
                + '<button class="tt-btn tt-btn-primary" onclick="window._ttGoalEditConfirm && window._ttGoalEditConfirm()">Save</button>'
                + '</div></div>'
            );
        };

        // ── AI-suggested challenges (milestones over existing activities) ──
        // One click builds a real challenge in the same shape saveChallenge
        // produces, so the Challenges tab treats it like any hand-made one.
        window.ttAcceptChallenge = function(chId) {
            var tt = ensureTechTree();
            var sug = (tt.suggestedChallenges || []).find(function(c) { return c.id === chId; });
            if (!sug || sug.status !== 'suggested') return;
            var targets = {};
            Object.keys(sug.activityTargets || {}).forEach(function(id) {
                if (ttFindActivity(id)) targets[id] = sug.activityTargets[id];
            });
            var ids = Object.keys(targets);
            if (!ids.length) { showToast('The activities in this challenge no longer exist', 'olive'); return; }
            var totalBase = ids.reduce(function(s, id) {
                var e = ttFindActivity(id);
                return s + (e.activity.baseXP || 1) * targets[id];
            }, 0);
            var progress = {};
            ids.forEach(function(id) { progress[id] = 0; });
            var end = new Date(Date.now() + (sug.durationDays || 30) * 86400000);
            if (!window.userData.challenges) window.userData.challenges = [];
            window.userData.challenges.push({
                id: Date.now().toString(),
                name: sug.title,
                description: sug.description || '',
                targetCount: ids.reduce(function(s, id) { return s + targets[id]; }, 0),
                bonusXP: Math.max(1, Math.round(totalBase * 0.2)),
                startDate: toLocalDateStr(new Date()),
                endDate: toLocalDateStr(end),
                activityIds: ids, activityTargets: targets, activityProgress: progress,
                activityId: null, currentCount: 0,
                metricEnabled: false, metricQty: null, metricUnit: null, metricCurrent: 0,
                activityProgressCollapsed: true,
                enforceActivities: false, enforceDateRange: false,
                status: 'active',
                createdAt: new Date().toISOString(),
                source: 'tech_tree'
            });
            sug.status = 'accepted';
            saveUserData().catch(function() {});
            showToast('🏆 Challenge added: ' + sug.title, 'green');
            updateDashboard();
            renderTechTree();
        };

        window.ttDismissChallenge = function(chId) {
            var tt = ensureTechTree();
            var sug = (tt.suggestedChallenges || []).find(function(c) { return c.id === chId; });
            if (!sug) return;
            sug.status = 'dismissed';
            saveUserData().catch(function() {});
            renderTechTree();
        };

        // ── Hooks into existing flows ────────────────────────────────────

        // Render on sub-tab switch
        (function() {
            var _orig = window.switchSubTab;
            window.switchSubTab = function(parentTab, subTab) {
                _orig(parentTab, subTab);
                if (parentTab === 'activities' && subTab === 'techTree') renderTechTree();
            };
        })();

        // Mastery re-evaluation after every completion
        (function() {
            var _orig = window.completeActivity;
            if (typeof _orig === 'function') {
                window.completeActivity = async function() {
                    await _orig.apply(this, arguments);
                    if (evaluateTechTreeMastery()) {
                        debouncedSaveUserData();
                        ttRenderIfVisible();
                    }
                };
            }
        })();

        // Activity modal: show/prefill the mastery field for accept-as-new and
        // for edits of activities that already carry a threshold.
        (function() {
            var _orig = window.openActivityModal;
            window.openActivityModal = function(dimIndex, pathIndex, actIndex) {
                if (actIndex === undefined) actIndex = null;
                _orig(dimIndex, pathIndex, actIndex);
                var grp = document.getElementById('ttMasteryGroup');
                if (!grp) return;
                var ctx = window._ttAcceptContext;
                if (actIndex === null && ctx) {
                    var tt = ensureTechTree();
                    var node = tt.nodes.find(function(n) { return n.id === ctx.nodeId; });
                    var sug = (node && node.suggestedActivity) || {};
                    if (sug.name) document.getElementById('activityName').value = sug.name;
                    var descEl = document.getElementById('activityDescription');
                    if (descEl && sug.description) descEl.value = sug.description;
                    if (sug.baseXP) {
                        document.getElementById('activityXP').value = Math.min(50, Math.max(1, parseInt(sug.baseXP) || 10));
                        if (typeof syncActivityXPPreset === 'function') syncActivityXPPreset();
                    }
                    var freqEl = document.getElementById('activityFrequency');
                    var freq = ['daily', 'occasional', 'weekly', 'biweekly', 'monthly', 'custom'].indexOf(sug.frequency) !== -1 ? sug.frequency : 'daily';
                    freqEl.value = freq;
                    if (typeof toggleCustomDays === 'function') toggleCustomDays();
                    var dimSel = document.getElementById('activityDimSelect');
                    var dimId = sug.dimensionId || (node && node.dimensionId);
                    if (dimId && Array.prototype.some.call(dimSel.options, function(o) { return o.value === dimId; })) {
                        dimSel.value = dimId;
                        if (typeof populateActivityPathSelect === 'function') populateActivityPathSelect();
                        var pathSel = document.getElementById('activityPathSelect');
                        if (sug.suggestedPathId && pathSel && Array.prototype.some.call(pathSel.options, function(o) { return o.value === sug.suggestedPathId; })) {
                            pathSel.value = sug.suggestedPathId;
                        }
                    }
                    var def = ttMasteryDefaultFor(freq);
                    document.getElementById('ttMasteryCount').value = def.count;
                    document.getElementById('ttMasteryWindow').value = def.windowDays || '';
                    grp.style.display = '';
                } else if (actIndex !== null) {
                    var act = window.userData.dimensions[dimIndex] && window.userData.dimensions[dimIndex].paths[pathIndex]
                        && window.userData.dimensions[dimIndex].paths[pathIndex].activities[actIndex];
                    if (act && act.techTreeMastery) {
                        document.getElementById('ttMasteryCount').value = act.techTreeMastery.count || 1;
                        document.getElementById('ttMasteryWindow').value = act.techTreeMastery.windowDays || '';
                        grp.style.display = '';
                    } else {
                        grp.style.display = 'none';
                    }
                } else {
                    grp.style.display = 'none';
                }
            };
        })();

        // Abandoning the modal cancels a pending accept-as-new
        (function() {
            var _orig = window.closeActivityModal;
            if (typeof _orig === 'function') {
                window.closeActivityModal = function() {
                    _orig.apply(this, arguments);
                    window._ttAcceptContext = null;
                };
            }
        })();

        // "Add to Tech Tree" in the grid card long-press menu (spec §6)
        (function() {
            var _orig = window.openGridActionMenu;
            if (typeof _orig === 'function') {
                window.openGridActionMenu = function(activityId) {
                    _orig(activityId);
                    var inner = document.querySelector('#gcActionMenu .gc-action-menu-inner');
                    if (!inner || inner.querySelector('[data-tt-add]')) return;
                    var cancel = inner.querySelector('.gc-action-cancel');
                    var btn = document.createElement('button');
                    btn.className = 'gc-action-item';
                    btn.setAttribute('data-tt-add', '1');
                    btn.innerHTML = '<span class="gc-action-icon">' + ttIcon('branch', 14) + '</span><span>Add to Tech Tree</span>';
                    btn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        closeGridActionMenu();
                        setTimeout(function() { ttAddActivityToTree(activityId); }, 60);
                    });
                    inner.insertBefore(btn, cancel);
                };
            }
        })();

        // Re-attach the result listener on app load if a request was pending
        // when the app was last closed.
        (function() {
            var tries = 0;
            var timer = setInterval(function() {
                tries++;
                if (window.userData && window.currentUser) {
                    clearInterval(timer);
                    var tt = window.userData.techTree;
                    if (tt && tt.pendingRequest) ttEnsureListener();
                } else if (tries > 60) {
                    clearInterval(timer);
                }
            }, 1000);
        })();
