/* ---------- Supabase setup ----------
   Paste your project URL and anon key (Project Settings > API).
   The anon key is meant to be public; the database rules in setup.sql
   are what actually protect your data. */
const SUPABASE_URL = 'https://hhserwawzwwxpeorbsvo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhoc2Vyd2F3end3eHBlb3Jic3ZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0NjEzNzIsImV4cCI6MjEwODAzNzM3Mn0.036NarzBsCKDXoVmgxy5qz5n-iEcfv5hPjNCz_XCRjg';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const store = {
    async list() {
        const { data, error } = await sb.from('letters')
            .select('id, author, message, created_at')
            .order('created_at', { ascending: false });
        if (error) { console.error(error); toast('Could not load letters'); return []; }
        return data;
    },
    async add(letter) {
        const { data, error } = await sb.from('letters')
            .insert({ author: letter.author, message: letter.message })
            .select('id')
            .single();
        if (error) throw error;
        return data.id;
    },
    async remove(id) {
        const { error } = await sb.from('letters').delete().eq('id', id);
        if (error) throw error;
    }
};

/* ---------- Attachments (stored in Netlify Blobs, keyed by letter id) ---------- */
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const attachments = {
    async list() {
        try {
            const res = await fetch('/api/attachments');
            return res.ok ? await res.json() : {};
        } catch (err) { console.error(err); return {}; }
    },
    async upload(letterId, file) {
        const res = await fetch(`/api/attachments/${letterId}`, {
            method: 'POST',
            headers: {
                'Content-Type': file.type || 'application/octet-stream',
                'X-File-Name': encodeURIComponent(file.name),
                'X-Supabase-Key': SUPABASE_ANON_KEY
            },
            body: file
        });
        if (!res.ok) throw new Error(await res.text());
    },
    remove(letterId) {
        return fetch(`/api/attachments/${letterId}`, {
            method: 'DELETE',
            headers: { 'X-Supabase-Key': SUPABASE_ANON_KEY }
        }).catch(console.error);
    }
};

let isOwner = false;
let chosenFile = null;

const $ = id => document.getElementById(id);
const wall = $('letter-wall');
const modal = $('letter-modal');
const ownerBtn = $('owner-login-btn');

function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2400);
}

function setOwner(on) {
    isOwner = on;
    document.body.classList.toggle('owner-mode', on);
    ownerBtn.textContent = on ? 'Owner logout' : 'Owner login';
}

ownerBtn.addEventListener('click', async () => {
    if (isOwner) {
        await sb.auth.signOut();
        setOwner(false);
        return toast('Owner mode off');
    }
    const email = prompt('Owner email:');
    if (!email) return;
    const password = prompt('Owner password:');
    if (!password) return;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return toast('Login failed');
    setOwner(true);
    toast('Owner mode on. You can delete letters.');
});

sb.auth.getSession().then(({ data }) => { if (data.session) setOwner(true); });

/* ---------- Modal ---------- */
function openModal() {
    $('form-error').textContent = '';
    modal.classList.remove('hidden');
    $('letter-input').focus();
}
function closeModal() {
    modal.classList.add('hidden');
    $('letter-input').value = '';
    $('author-input').value = '';
    clearFile();
    $('open-modal-btn').focus();
}

function formatSize(bytes) {
    return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function clearFile() {
    chosenFile = null;
    $('file-input').value = '';
    $('file-chosen').classList.add('hidden');
    const thumb = $('file-thumb');
    if (thumb.src) URL.revokeObjectURL(thumb.src);
    thumb.removeAttribute('src');
    thumb.classList.add('hidden');
}

$('file-input').addEventListener('change', () => {
    const file = $('file-input').files[0];
    clearFile();
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
        $('form-error').textContent = 'That file is over 4 MB. Try a smaller one.';
        return;
    }
    $('form-error').textContent = '';
    chosenFile = file;
    $('file-name').textContent = `${file.name} (${formatSize(file.size)})`;
    if (file.type.startsWith('image/')) {
        $('file-thumb').src = URL.createObjectURL(file);
        $('file-thumb').classList.remove('hidden');
    }
    $('file-chosen').classList.remove('hidden');
});
$('file-clear').addEventListener('click', clearFile);
$('open-modal-btn').addEventListener('click', openModal);
$('close-modal-btn').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
});

$('submit-letter-btn').addEventListener('click', async () => {
    const message = $('letter-input').value.trim();
    const author = $('author-input').value.trim() || 'Anonymous';
    if (!message) {
        $('form-error').textContent = 'Write something before posting.';
        return;
    }
    const submitBtn = $('submit-letter-btn');
    const file = chosenFile;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';
    let letterId;
    try {
        letterId = await store.add({ author, message });
    } catch (err) {
        console.error(err);
        $('form-error').textContent = 'Could not post your letter. Try again.';
        return resetSubmit();
    }
    let fileFailed = false;
    if (file) {
        try { await attachments.upload(letterId, file); }
        catch (err) { console.error(err); fileFailed = true; }
    }
    resetSubmit();
    closeModal();
    await loadLetters();
    const rect = $('open-modal-btn').getBoundingClientRect();
    heartBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, 22);
    toast(fileFailed ? 'Letter posted, but the file could not be attached' : 'Letter sent with love');

    function resetSubmit() {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send with love';
    }
});

/* ---------- Rendering ---------- */
function toggleCard(card) {
    const opening = !card.classList.contains('open');
    wall.querySelectorAll('.letter-card.open').forEach(c => {
        c.classList.replace('open', 'closed');
        c.setAttribute('aria-expanded', 'false');
    });
    if (opening) {
        card.classList.replace('closed', 'open');
        card.setAttribute('aria-expanded', 'true');
    }
}

function renderAttachment(letter, file) {
    const url = `/api/attachments/${letter.id}`;
    if (/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type)) {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener';
        const img = document.createElement('img');
        img.className = 'attachment-img';
        img.src = url;
        img.alt = file.name;
        img.loading = 'lazy';
        link.appendChild(img);
        return link;
    }
    const link = document.createElement('a');
    link.className = 'attachment-link';
    link.href = url;
    link.download = file.name;
    link.textContent = `📎 ${file.name} (${formatSize(file.size)})`;
    return link;
}

function renderLetter(letter, file) {
    const card = document.createElement('div');
    card.className = 'letter-card closed';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-expanded', 'false');

    // textContent (not innerHTML) so visitors can't inject HTML/scripts
    const h3 = document.createElement('h3');
    h3.textContent = `From: ${letter.author}`;
    const date = document.createElement('p');
    date.className = 'date';
    date.textContent = new Date(letter.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const preview = document.createElement('p');
    preview.className = 'date preview-text';
    preview.textContent = 'Click to open...';
    const content = document.createElement('div');
    content.className = 'letter-content';
    const body = document.createElement('p');
    body.textContent = letter.message;
    content.appendChild(body);
    if (file) content.appendChild(renderAttachment(letter, file));
    const del = document.createElement('button');
    del.className = 'delete-btn';
    del.textContent = 'Delete';

    card.append(h3, date, preview, content, del);
    if (file) {
        const badge = document.createElement('span');
        badge.className = 'clip-badge';
        badge.textContent = '📎';
        badge.title = 'Has an attachment';
        card.appendChild(badge);
    }

    card.addEventListener('click', e => {
        if (e.target === del || e.target.closest('a')) return;
        toggleCard(card);
    });
    card.addEventListener('keydown', e => {
        if (e.target !== card) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCard(card); }
    });
    del.addEventListener('click', async e => {
        e.stopPropagation();
        if (!isOwner) return; // UI guard only; enforce on the backend too
        if (confirm('Are you sure you want to remove this letter?')) {
            try { await store.remove(letter.id); }
            catch (err) { console.error(err); return toast('Delete not allowed'); }
            if (file) attachments.remove(letter.id);
            card.remove();
            if (!wall.children.length) loadLetters();
            toast('Letter deleted');
        }
    });
    return card;
}

async function loadLetters() {
    const [letters, files] = await Promise.all([store.list(), attachments.list()]);
    wall.replaceChildren();
    if (!letters.length) {
        const empty = document.createElement('p');
        empty.className = 'empty';
        empty.textContent = 'The wall is empty. Leave the first letter.';
        wall.appendChild(empty);
        return;
    }
    letters.forEach(l => wall.appendChild(renderLetter(l, files[l.id])));
}

/* ---------- Love effects ---------- */
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const HEART_COLORS = ['#ff4f8b', '#ff78a8', '#ffa3c4', '#c2185b', '#ffffff'];

function heartBurst(x, y, count = 9) {
    if (reduceMotion) return;
    for (let i = 0; i < count; i++) {
        const h = document.createElement('span');
        h.className = 'burst-heart';
        const size = 10 + Math.round(Math.random() * 3) * 6; // pixel-ish size steps
        h.style.width = `${size}px`;
        h.style.height = `${Math.round(size * 6 / 7)}px`;
        h.style.left = `${x - size / 2}px`;
        h.style.top = `${y - size / 2}px`;
        h.style.background = HEART_COLORS[i % HEART_COLORS.length];
        document.body.appendChild(h);
        const angle = (Math.PI * 2 * i) / count + Math.random() * .6;
        const dist = 40 + Math.random() * 60;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist - 30;
        h.animate([
            { transform: 'translate(0, 0) scale(.4)', opacity: 1 },
            { transform: `translate(${dx * .7}px, ${dy * .7}px) scale(1.1)`, opacity: 1, offset: .6 },
            { transform: `translate(${dx}px, ${dy + 25}px) scale(.8)`, opacity: 0 }
        ], { duration: 700 + Math.random() * 300, easing: 'steps(12)' }).onfinish = () => h.remove();
    }
}

document.addEventListener('pointerdown', e => heartBurst(e.clientX, e.clientY));

function fillSky() {
    if (reduceMotion) return;
    const sky = document.querySelector('.sky');
    for (let i = 0; i < 16; i++) {
        const h = document.createElement('span');
        h.className = 'float-heart';
        const size = 12 + Math.round(Math.random() * 4) * 7;
        h.style.width = `${size}px`;
        h.style.height = `${Math.round(size * 6 / 7)}px`;
        h.style.left = `${Math.random() * 100}%`;
        h.style.animationDuration = `${14 + Math.random() * 16}s`;
        h.style.animationDelay = `${-Math.random() * 30}s`;
        if (i % 3 === 0) h.style.background = '#fff';
        sky.appendChild(h);
    }
}
fillSky();

loadLetters();
