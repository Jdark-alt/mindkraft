// ── Anthropic model call ────────────────────────────────────────────────────
//
// The single place any Cloud Function talks to the model. Native fetch, no SDK,
// no new dependency.
//
// SHARED ON PURPOSE — the Quest Composer and the Map weaver both go through
// it. Its behaviour carries over the lessons of the GitHub Actions worker the
// Map used to run on:
//
//   - STREAM. A large generation runs well past two minutes of wall clock. A
//     plain fetch timeout kills healthy-but-slow generation; watching the
//     stream for a stall does not.
//   - Two clocks, not one: abort when the stream goes quiet (idleMs), or when
//     the whole thing runs too long (totalMs). Never on duration alone.
//   - A 413 is not fatal. The API says how much it will take; ask for less and
//     try again rather than failing the user's request.
//
// The key arrives as a plain runtime environment variable, written into
// functions/.env at deploy time from the repo's ANTHROPIC_API_KEY secret —
// deliberately not Secret Manager, which needs IAM roles the CI service
// account does not have.

const API_BASE = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';

// Pinned by the deploy environment. Do not change one without the other.
function modelName() {
    return process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
}

function timeoutError(message) {
    const err = new Error(message);
    err.name = 'TimeoutError';
    return err;
}

async function streamOnce({ system, user, maxTokens, temperature, idleMs, totalMs }) {
    const key = (process.env.ANTHROPIC_API_KEY || '').trim();
    if (!key) throw new Error('ANTHROPIC_API_KEY is missing or empty');

    const controller = new AbortController();
    let idleTimer = null;
    const totalTimer = setTimeout(
        () => controller.abort(timeoutError(`model stream exceeded ${totalMs / 1000}s total`)),
        totalMs
    );
    const bumpIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(
            () => controller.abort(timeoutError(`model stream stalled >${idleMs / 1000}s`)),
            idleMs
        );
    };
    bumpIdle();

    try {
        const res = await fetch(API_BASE + '/v1/messages', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'x-api-key': key,
                'anthropic-version': API_VERSION,
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
            },
            body: JSON.stringify({
                model: modelName(),
                max_tokens: maxTokens,
                temperature,
                system,
                messages: [{ role: 'user', content: user }],
                stream: true,
            }),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Model API error ${res.status}: ${text.slice(0, 300)}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let text = '';
        let stopReason = null;

        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bumpIdle();
            buf += decoder.decode(value, { stream: true });
            let nl;
            while ((nl = buf.indexOf('\n')) !== -1) {
                const line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                if (!line.startsWith('data:')) continue;
                const payload = line.slice(5).trim();
                if (!payload || payload === '[DONE]') continue;
                let ev;
                try { ev = JSON.parse(payload); } catch (e) { continue; }
                if (ev.type === 'content_block_delta' && ev.delta && typeof ev.delta.text === 'string') {
                    text += ev.delta.text;
                } else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) {
                    stopReason = ev.delta.stop_reason;
                } else if (ev.type === 'error') {
                    throw new Error('Model stream error: ' + JSON.stringify(ev.error || ev).slice(0, 300));
                }
            }
        }

        if (!text) throw new Error('Model returned no content');
        return { content: text, truncated: stopReason === 'max_tokens' };
    } finally {
        clearTimeout(totalTimer);
        if (idleTimer) clearTimeout(idleTimer);
    }
}

/**
 * Call the model and return { content, truncated }.
 * Retries a 413 with a smaller budget; everything else fails fast, because a
 * user is sitting there waiting.
 */
async function callModel({
    system,
    user,
    maxTokens = 2000,
    temperature = 0.6,
    idleMs = 25000,
    totalMs = 50000,
    attempts = 2,
}) {
    let lastErr = null;
    let tokens = maxTokens;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await streamOnce({ system, user, maxTokens: tokens, temperature, idleMs, totalMs });
        } catch (err) {
            lastErr = err;
            const msg = err.message || '';

            // The API states its own ceiling — honour it instead of failing.
            if (/Model API error 413/.test(msg)) {
                const fit = msg.match(/Limit (\d+), Requested (\d+)/);
                tokens = fit ? Math.max(500, parseInt(fit[1], 10) - 200) : Math.max(500, Math.floor(tokens / 2));
                continue;
            }
            // A 429 or 5xx may pass on a second try; a 4xx will not.
            if (/Model API error (429|5\d\d)/.test(msg) && attempt < attempts) continue;
            throw err;
        }
    }
    throw lastErr || new Error('Model call failed');
}

/**
 * Pull the first JSON object out of a model response, tolerating markdown
 * fences and any prose the model adds despite being told not to.
 */
function parseModelJson(raw) {
    let text = String(raw == null ? '' : raw).trim()
        .replace(/^```(?:json)?/m, '')
        .replace(/```\s*$/m, '')
        .trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch (e) {
        return null;
    }
}

module.exports = { callModel, parseModelJson, modelName };
