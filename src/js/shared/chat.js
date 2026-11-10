// 引入加密解密函数
import { lol } from './crypt.js';
import { logApi } from "./apiLog.js";
import { API_BASE, callerIdentity } from "./api.js";

// DOM elements resolve lazily (bindDom) so this module imports cleanly on pages
// where the widget is injected after scripts run, or isn't present at all.
let chatBox, textInput, sendBtn, uploadBtn, imageInput, imageModal, modalImage;

let messages = [];
let pendingImageBase64 = null;
let pendingImageMime = 'image/jpeg';
let caseId = null;
let domBound = false;
// `null` = "force the next render". Real signatures are always strings, so the
// sentinel can never equal one — an empty chat still renders/clears once.
let lastNotesSignature = null;

// Poll only while the panel is open and the tab visible; hard-stop (timer +
// in-flight abort) on close or unload so no fetch competes with the next page.
let pollTimer = null;        // setInterval handle while the chat is live
let pollInFlight = false;    // guards against overlapping polls
let notesInFlight = false;   // a /notes/get request is currently running
let notesAbort = null;       // AbortController for the in-flight notes fetch
let lifecycleBound = false;  // visibilitychange/pagehide bound once

// Poll cadence while the chat is open and the tab is focused.
const CHAT_POLL_MS = 3000;

// Per-case cache of the last rendered conversation. /notes returns every image
// inline, so painting this first makes reopening instant while the refresh lands.
const CHAT_CACHE_PREFIX = 'chat_cache_';
const cacheKey = (id) => `${CHAT_CACHE_PREFIX}${id}`;

// Author tag used for the local-only "pending upload" preview bubble.
const PREVIEW_AUTHOR = 'Click send to upload image';

// Priority: an explicit encrypted id, the page's ?id=, then
// window.SMARTRPD_CHAT_CASE_ID (pages tracking the case in memory, not the URL).
function resolveCaseId(explicitEncryptedId) {
    const enc =
        explicitEncryptedId ||
        new URLSearchParams(window.location.search).get('id') ||
        window.SMARTRPD_CHAT_CASE_ID ||
        null;
    if (!enc) return null;
    const decoded = lol(enc);
    return decoded || null;
}

// Signed-in users post under their username; guests (a shared viewer link) may
// chat but are labelled "Guest" so their messages read as unauthenticated.
function currentUsername() {
    try {
        const u = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
        return u?.username || 'Guest';
    } catch {
        return 'Guest';
    }
}

// 推测 MIME 类型
function detectImageMime(base64) {
    const signature = base64.substring(0, 5);
    if (signature.startsWith('/9j/')) return 'image/jpeg';
    if (signature.startsWith('iVBOR')) return 'image/png';
    if (signature.startsWith('R0lG')) return 'image/gif';
    if (signature.startsWith('UklGR')) return 'image/webp';
    return 'image/jpeg';
}

// Base64 images can blow the localStorage quota, so fall back to a text-only
// cache on failure, then give up quietly.
function saveCachedMessages(id, msgs) {
    if (!id || !Array.isArray(msgs)) return;
    const key = cacheKey(id);
    try {
        localStorage.setItem(key, JSON.stringify(msgs));
    } catch {
        try {
            const textOnly = msgs.map((m) => ({
                ...m,
                content: String(m.content || '').replace(/<img\b[^>]*>/gi, ''),
            }));
            localStorage.setItem(key, JSON.stringify(textOnly));
        } catch {
            try { localStorage.removeItem(key); } catch { /* ignore */ }
        }
    }
}

function loadCachedMessages(id) {
    if (!id) return null;
    try {
        const raw = localStorage.getItem(cacheKey(id));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

// Paint the last-known conversation immediately (before the network lands) so
// reopening a chat feels instant. fetchNotes overwrites it once data arrives.
function renderCachedMessages() {
    if (!chatBox || !caseId || messages.length) return;
    const cached = loadCachedMessages(caseId);
    if (cached && cached.length) {
        messages = cached;
        displayMessages();
    }
}

// 获取历史记录
async function fetchNotes() {
    if (!caseId || !chatBox) return;
    // True single-flight: SKIP while a notes request runs, never abort-and-restart
    // — that multiplied the heavy query and starved the case list. Close still aborts.
    if (notesInFlight) return;
    notesAbort?.abort();
    const ctrl = new AbortController();
    notesAbort = ctrl;
    notesInFlight = true;
    const t0 = performance.now();
    try {
        const response = await fetch(`${API_BASE}/notes/get/${caseId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
            signal: ctrl.signal
        });
        logApi(response, 'POST /notes/get/:id');
        if (response.ok) {
            const tNet = performance.now();
            const notes = await response.json();
            const tParse = performance.now();
            // Splits network vs JSON.parse: a big parse number means the list is
            // image-heavy (the argument for an image-URL endpoint).
            const lenKB = Number(response.headers.get('content-length') || 0) / 1024;
            console.log(
                `[chat] notes/get: ${notes.length} notes` +
                (lenKB ? `, ${lenKB.toFixed(0)}KB` : '') +
                `, net ${Math.round(tNet - t0)}ms, parse ${Math.round(tParse - tNet)}ms`
            );
            notes.reverse();
            // Re-render only on real change, so the poll never yanks scroll or
            // re-stringifies every base64 image into HTML every 3s.
            const signature = notes
                .map(n => n.id ?? `${n.author_username}:${n.created_at}`)
                .join('|');
            if (signature === lastNotesSignature) return;
            lastNotesSignature = signature;

            messages = notes.map(note => {
                let content = '';
                if (note.image_base64) {
                    const mimeType = detectImageMime(note.image_base64);
                    content += `<img src="data:${mimeType};base64,${note.image_base64}" alt="Note Image" class="uploaded-image" loading="lazy" decoding="async" />`;
                }
                if (note.content) {
                    content += `<div class="msg-text">${note.content}</div>`;
                }
                return {
                    content,
                    author: note.author_username,
                    timestamp: new Date(note.created_at).toLocaleString(),
                };
            });
            // Cache the server conversation (without the local-only preview bubble)
            // for an instant paint on the next open.
            saveCachedMessages(caseId, messages);
            // Keep any in-progress image preview visible across refreshes.
            if (pendingImageBase64) messages.push(buildPendingPreviewMessage());
            displayMessages();
        } else {
            // Keep the cached paint on failure — prior messages stay visible.
            console.error('❌ Failed to fetch notes:', await response.text());
        }
    } catch (err) {
        // Aborts are expected (panel closed / navigated away) — not errors.
        if (err?.name === 'AbortError') return;
        console.error('❌ Error fetching notes:', err);
    } finally {
        // Only the current request clears the flags — an older request that was
        // aborted by a forced restart must not reset state owned by the new one.
        if (notesAbort === ctrl) {
            notesAbort = null;
            notesInFlight = false;
        }
    }
}

// One guarded poll. A closed panel (is-hidden) stops the whole loop; an in-flight
// request, no case, or a backgrounded tab merely skips this tick.
async function pollTick() {
    const widget = document.getElementById('chat-widget');
    if (!widget || widget.classList.contains('is-hidden')) {
        stopChatLive();
        return;
    }
    if (pollInFlight || !caseId || !chatBox || document.hidden) return;
    pollInFlight = true;
    try {
        await fetchNotes();
    } finally {
        pollInFlight = false;
    }
}

// Bound once: returning to the tab refreshes immediately, and leaving the page
// hard-stops the chat so no request lingers into the next one.
function bindChatLifecycle() {
    if (lifecycleBound) return;
    lifecycleBound = true;
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && pollTimer) fetchNotes();
    });
    window.addEventListener('pagehide', stopChatLive);
}

// Go live: refresh immediately, then poll while the panel is open + tab visible.
function startChatLive() {
    bindChatLifecycle();
    stopChatLive();                 // never run two timers
    renderCachedMessages();         // instant paint from the last-known cache
    fetchNotes();                   // immediate refresh on open
    pollTimer = setInterval(pollTick, CHAT_POLL_MS);
}

// Hard-stop: clear the poll timer and abort any in-flight notes request. Called
// when the panel closes and on page unload (back to the case list).
function stopChatLive() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (notesAbort) { notesAbort.abort(); notesAbort = null; }
    pollInFlight = false;
    notesInFlight = false;
}

// 渲染消息
function displayMessages() {
    if (!chatBox) return;
    chatBox.innerHTML = '';
    const me = currentUsername();
    messages.forEach(msg => {
        const isPreview = msg.author === PREVIEW_AUTHOR;
        // My own notes sit on the right ("You"); everyone else's on the left
        // labelled with their username.
        const mine = isPreview || msg.author === 'You' || msg.author === me;

        const messageElement = document.createElement('div');
        messageElement.classList.add('chat-message');
        messageElement.classList.add(mine ? 'is-mine' : 'is-theirs');

        const contentElement = document.createElement('div');
        contentElement.classList.add('message-content');
        contentElement.innerHTML = msg.content;
        messageElement.appendChild(contentElement);

        const timestampElement = document.createElement('div');
        timestampElement.classList.add('timestamp');
        timestampElement.textContent = msg.timestamp;
        messageElement.appendChild(timestampElement);

        if (!isPreview) {
            const authorElement = document.createElement('div');
            authorElement.classList.add('author');
            authorElement.textContent = mine ? 'You' : msg.author;
            messageElement.appendChild(authorElement);
        }

        chatBox.appendChild(messageElement);
    });

    // 滚动到底
    const images = chatBox.querySelectorAll('img');
    if (images.length > 0) {
        images[images.length - 1].onload = () => {
            chatBox.scrollTop = chatBox.scrollHeight;
        };
    } else {
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}

// 提交新消息
async function createNote(content, imageBase64 = null) {
    if (!caseId) return;
    try {
        const response = await fetch(`${API_BASE}/case/activity/note`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([callerIdentity(), {
                caseIntID: Number(caseId),
                content: content || null,
                image: imageBase64 || null,
                operation: crypto.randomUUID(),
            }])
        });
        logApi(response, 'POST /case/activity/note');
        if (!response.ok) {
            console.error('❌ Failed to create note:', response.status);
        }
    } catch (err) {
        console.error('❌ Error creating note:', err);
    }
}

// 点击发送按钮
async function handleSendMessage() {
    const message = textInput.value.trim();
    if (!message && !pendingImageBase64) return;

    const sentImage = pendingImageBase64;
    const sentMime = pendingImageMime;

    // Clear the input right away so it disappears the instant you send — don't
    // wait for the (possibly slow) network round-trip below.
    textInput.value = '';
    imageInput.value = '';
    pendingImageBase64 = null;
    autoResizeInput();

    // Optimistic echo. Built by concatenation (no template-literal indentation)
    // so the pre-wrapped text doesn't render blank lines above/below it.
    removePendingPreview();
    let echo = '';
    if (sentImage) echo += `<img src="data:${sentMime};base64,${sentImage}" alt="Image" class="uploaded-image" loading="lazy" decoding="async" />`;
    if (message) echo += `<div class="msg-text">${message}</div>`;
    messages.push({
        content: echo,
        author: 'You',
        timestamp: new Date().toLocaleString(),
    });
    displayMessages();

    await createNote(message, sentImage);
    fetchNotes();
}


// Drop the local-only "pending upload" preview bubble from the message list.
function removePendingPreview() {
    messages = messages.filter(m => m.author !== PREVIEW_AUTHOR);
}

// Build the "pending upload" preview message (shown until Send is pressed).
function buildPendingPreviewMessage() {
    return {
        content: `
        <div class="upload-preview-wrap">
            <img src="data:${pendingImageMime};base64,${pendingImageBase64}" alt="Preview" class="uploaded-image" decoding="async" />
            <button type="button" class="upload-preview-remove" onclick="clearImage()" aria-label="Remove image">&times;</button>
        </div>
    `,
        author: PREVIEW_AUTHOR,
        timestamp: new Date().toLocaleString(),
    };
}

// 渲染预览图（上传/粘贴共用）
function previewImage(base64, mime = 'image/jpeg') {
    pendingImageBase64 = base64;
    pendingImageMime = mime;
    removePendingPreview();
    messages.push(buildPendingPreviewMessage());
    displayMessages();
}
// Auto-grow the comment textarea with its content, capped at 5 rows; once the
// cap is reached it scrolls instead of growing further.
const MAX_INPUT_ROWS = 5;
function autoResizeInput() {
    if (!textInput) return;
    // Skip while hidden: scrollHeight is 0 under display:none, so sizing here
    // would squash the box to ~0 until the user types.
    if (!textInput.offsetParent) return;
    const cs = getComputedStyle(textInput);
    const lineHeight = parseFloat(cs.lineHeight) || 20;
    const padding = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const maxH = lineHeight * MAX_INPUT_ROWS + padding + border;
    textInput.style.height = 'auto';
    const next = Math.min(textInput.scrollHeight + border, maxH);
    textInput.style.height = next + 'px';
    textInput.style.overflowY = textInput.scrollHeight + border > maxH ? 'auto' : 'hidden';
}

// Read an image File into a base64 preview (shared by the upload button,
// Ctrl+V paste and drag-and-drop). Ignores non-image files.
function readImageFile(file) {
    if (!file || file.type.indexOf('image') === -1) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        const base64 = e.target.result.split(',')[1];
        previewImage(base64, file.type || 'image/jpeg');
    };
    reader.readAsDataURL(file);
}

// 上传图片
function handleImageUpload(event) {
    readImageFile(event.target.files[0]);
}

// 取消图片预览（不清除文本）
window.clearImage = function () {
    pendingImageBase64 = null;
    removePendingPreview();
    displayMessages();
    if (imageInput) imageInput.value = '';
};

// Bind DOM + event listeners exactly once. Returns false when the chat widget
// isn't on the page, so callers can no-op gracefully.
function bindDom() {
    if (domBound) return true;
    chatBox = document.getElementById('chat-box');
    textInput = document.getElementById('textInput');
    sendBtn = document.getElementById('sendBtn');
    uploadBtn = document.getElementById('uploadBtn');
    imageInput = document.getElementById('imageInput');
    imageModal = document.getElementById('imageModal');
    modalImage = document.getElementById('modalImage');
    const chatWidget = document.getElementById('chat-widget');
    if (!chatBox || !textInput || !sendBtn || !uploadBtn || !imageInput) return false;
    domBound = true;

    // Ctrl+V 粘贴图片
    textInput.addEventListener('paste', function (e) {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (const item of items) {
            if (item.type.indexOf("image") !== -1) {
                readImageFile(item.getAsFile());
            }
        }
    });

    // Press Enter to send; Shift+Enter inserts a newline (the textarea grows).
    textInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    // Grow the textarea with its content, up to 5 rows, then scroll.
    textInput.addEventListener('input', autoResizeInput);
    autoResizeInput();

    // Close like the app sidebar: click the backdrop / close button, or Escape.
    if (chatWidget) {
        chatWidget.querySelectorAll('[data-chat-close]').forEach((el) =>
            el.addEventListener('click', () => closeWidget(chatWidget))
        );
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && chatWidget.classList.contains('is-open')) {
                closeWidget(chatWidget);
            }
        });
    }

    // Same drop-zone pattern as createCase.js: bind to a concrete element (a
    // pointer-events:none overlay misses drops), relatedTarget stops the flicker.
    const hasFiles = (e) =>
        Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
    const dropZone = (chatWidget && chatWidget.querySelector('.chat-sidebar-panel')) || chatBox;
    if (dropZone) {
        dropZone.addEventListener('dragenter', (e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });
        dropZone.addEventListener('dragover', (e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
            dropZone.classList.add('drag-over');
        });
        dropZone.addEventListener('dragleave', (e) => {
            if (dropZone.contains(e.relatedTarget)) return;
            dropZone.classList.remove('drag-over');
        });
        dropZone.addEventListener('drop', (e) => {
            dropZone.classList.remove('drag-over');
            if (!hasFiles(e)) return;
            e.preventDefault();
            const file = Array.from(e.dataTransfer.files).find((f) =>
                f.type.startsWith('image/')
            );
            if (file) readImageFile(file);
        });
    }

    sendBtn.addEventListener('click', handleSendMessage);
    uploadBtn.addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', handleImageUpload);

    // 放大图片
    if (imageModal && modalImage) {
        chatBox.addEventListener('click', function (e) {
            if (e.target.tagName === 'IMG') {
                modalImage.src = e.target.src;
                imageModal.style.display = 'flex';
            }
        });
        imageModal.addEventListener('click', function () {
            imageModal.style.display = 'none';
        });
    }
    return true;
}

// Loads a case's conversation; true when the widget and a case id both resolve.
// Does NOT start polling — that is openWidget's job, so a closed panel stays quiet.
export function initChat(explicitEncryptedId) {
    if (!bindDom()) return false;
    const resolved = resolveCaseId(explicitEncryptedId);
    if (!resolved) return false;
    const changed = resolved !== caseId;
    caseId = resolved;
    if (changed) {
        // Switching cases: drop the old conversation and reset the signature so
        // the next fetch re-renders even if the new case is empty.
        messages = [];
        lastNotesSignature = null;
    }
    // No fetch here — the open path (openWidget) and the always-on boot path
    // each refresh once themselves, so initChat stays pure setup.
    return true;
}

// Slide the side panel in/out, matching the app sidebar's open/close timing
// (the 220ms delay before hiding lets the transform transition finish).
function openWidget(widget) {
    widget.classList.remove('is-hidden');
    requestAnimationFrame(() => {
        widget.classList.add('is-open');
        // Now that the panel is visible, size the textarea correctly (it can't
        // measure itself while hidden).
        autoResizeInput();
    });
    widget.setAttribute('aria-hidden', 'false');
    setTimeout(() => textInput && textInput.focus(), 60);
    // Go live now that the panel is open: refresh immediately, then poll for
    // incoming messages while it stays open (closeWidget / page-leave stop it).
    startChatLive();
}
function closeWidget(widget) {
    widget.classList.remove('is-open');
    widget.setAttribute('aria-hidden', 'true');
    setTimeout(() => widget.classList.add('is-hidden'), 220);
    // Stop polling + abort any in-flight fetch so a closed chat never keeps
    // hitting the network.
    stopChatLive();
}

// Toggle the chat side panel, lazily initialising it for the given case. Used
// by the footer chat button on the case list and 2D annotation pages.
export function toggleChat(explicitEncryptedId) {
    if (!bindDom()) return;
    const widget = document.getElementById('chat-widget');
    if (!widget) return;
    if (widget.classList.contains('is-open')) {
        closeWidget(widget);
        return;
    }
    // Only open once we have a case context to talk about.
    if (!initChat(explicitEncryptedId)) return;
    openWidget(widget);
}

// Always-on widgets (the 3D viewer's inline panel, which has no toggle) go live
// on boot. Slide-in widgets start .is-hidden and go live when opened.
if (new URLSearchParams(window.location.search).get('id')) {
    const boot = () => {
        // Closed slide-in panels stay off the network on boot: chat.js imports
        // first, so a notes/get would outrank the jaw STLs in the host queue.
        const widget = document.getElementById('chat-widget');
        if (widget && widget.classList.contains('is-hidden')) return;
        if (!initChat()) return;
        startChatLive();
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
}
