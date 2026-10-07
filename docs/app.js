'use strict';

const $ = id => document.getElementById(id);
const apiBase = (window.PHOTO_CONFIG?.apiBase || '').replace(/\/$/, '');
const postId = new URL(location.href).searchParams.get('post');
let photos = [], busy = false, selecting = false;

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

function configured() {
  if (apiBase) return true;
  status('保存先の設定が必要です。', true);
  return false;
}

async function api(path, options = {}) {
  const response = await fetch(apiBase + path, options);
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      if (postId === null) $('auth').open = true;
    }
    throw new Error(data.error || '操作できませんでした。');
  }
  return data;
}

function render() {
  $('previews').replaceChildren();
  $('count').textContent = `${photos.length} / 4`;
  $('upload').disabled = !photos.length || busy || selecting;
  $('choose').disabled = busy || selecting;

  photos.forEach((p, i) => {
    const box = document.createElement('div');
    box.className = 'preview';

    const img = document.createElement('img');
    img.src = p.url;
    img.alt = `選択した写真 ${i + 1}`;

    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.textContent = '×';
    remove.type = 'button';
    remove.disabled = busy || selecting;
    remove.setAttribute('aria-label', `写真 ${i + 1} を取り消す`);
    remove.onclick = () => {
      URL.revokeObjectURL(p.url);
      photos.splice(i, 1);
      render();
    };

    box.append(img, remove);
    $('previews').append(box);
  });
}

async function preparePhoto(file) {
  const source = URL.createObjectURL(file);
  const img = new Image();
  img.src = source;

  try {
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight)
      throw new Error('読み込めない写真です。');

    const canvas = document.createElement('canvas');
    let scale = Math.min(
      1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)
    );

    for (let attempt = 0; attempt < 5; attempt++) {
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('写真を縮小できませんでした。');

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      for (const quality of [0.85, 0.7, 0.55]) {
        const blob = await new Promise(resolve =>
          canvas.toBlob(resolve, 'image/jpeg', quality)
        );

        if (blob && blob.type === 'image/jpeg' && blob.size <= 1000000) {
          const photo = new File([blob], 'photo.jpg', {
            type: 'image/jpeg'
          });
          return {
            file: photo,
            url: URL.createObjectURL(photo)
          };
        }
      }
      scale *= 0.75;
    }

    throw new Error('写真を縮小できませんでした。別の写真を選んでください。');
  } finally {
    URL.revokeObjectURL(source);
    img.src = '';
  }
}

async function addFiles(list) {
  if (busy || selecting) return;
  const files = Array.from(list);

  if (photos.length + files.length > 4) {
    status('写真は4枚まで掲載できます。', true);
    return;
  }
  if (!files.length) return;

  const additions = [];
  selecting = true;
  render();
  status('写真を準備しています…');

  try {
    for (const file of files) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
        throw new Error('JPEG・PNG・WebPの写真だけ選べます。');

      if (!file.size || file.size > 8 * 1024 * 1024)
        throw new Error('元の写真は1枚8MBまでです。');

      additions.push(await preparePhoto(file));
    }

    photos.push(...additions);
    status('写真を確認して、アップロードを押してね。');
  } catch (e) {
    additions.forEach(p => URL.revokeObjectURL(p.url));
    status(e.message || '写真を読み込めませんでした。', true);
  } finally {
    selecting = false;
    render();
  }
}

$('choose').onclick = () => $('files').click();

$('files').onchange = () => {
  addFiles($('files').files);
  $('files').value = '';
};

$('dropzone').ondragover = e => {
  e.preventDefault();
  $('dropzone').classList.add('drag');
};

$('dropzone').ondragleave = () =>
  $('dropzone').classList.remove('drag');

$('dropzone').ondrop = e => {
  e.preventDefault();
  $('dropzone').classList.remove('drag');
  addFiles(e.dataTransfer.files);
};

$('upload').onclick = async () => {
  if (busy || selecting || !photos.length || !configured()) return;

  const password = $('password').value;
  if (!password) {
    $('auth').open = true;
    $('password').focus();
    status('投稿用の管理パスワードを入力してください。', true);
    return;
  }

  busy = true;
  render();
  $('upload').textContent = 'アップロード中…';
  status('写真を保存しています。この画面で少し待ってね。');

  try {
    const body = new FormData();
    photos.forEach(p => body.append('photos', p.file));

    const { id } = await api('/posts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${password}` },
      body
    });

    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('post', id);

    $('shareUrl').value = url.href;
    $('open').href = url.href;
    $('result').hidden = false;
    status('保存できました。リンクをコピーして共有できます。');
    $('result').scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });

    photos.forEach(p => URL.revokeObjectURL(p.url));
    photos = [];
  } catch (e) {
    status(
      e.message === 'Failed to fetch'
        ? '通信できませんでした。接続と保存先の設定を確認してください。'
        : e.message,
      true
    );
  } finally {
    busy = false;
    render();
    $('upload').textContent = '写真をアップロード';
  }
};

$('copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('shareUrl').value);
    $('copy').textContent = 'コピーしました ✓';
    setTimeout(() => {
      $('copy').textContent = 'URLをコピー';
    }, 2500);
  } catch {
    $('shareUrl').focus();
    $('shareUrl').select();
    status('URLを長押し、または Ctrl+C でコピーしてください。');
  }
};

$('again').onclick = () => {
  $('result').hidden = true;
  $('choose').focus();
  status('次の写真を選んでね。');
};

$('close').onclick = () => $('lightbox').close();

$('lightbox').onclick = e => {
  if (e.target === $('lightbox')) $('lightbox').close();
};

$('lightbox').onclose = () => {
  $('large').removeAttribute('src');
};

async function view() {
  $('composer').hidden = true;
  $('viewer').hidden = false;

  if (!/^[a-f0-9]{32}$/.test(postId)) {
    status('共有URLが正しくありません。', true);
    return;
  }
  if (!configured()) return;

  status('写真を読み込んでいます…');

  try {
    const post = await api(`/posts/${postId}`);
    $('gallery').replaceChildren();
    $('gallery').classList.toggle('single', post.count === 1);

    for (let i = 0; i < post.count; i++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', `写真 ${i + 1} を拡大`);

      const img = document.createElement('img');
      img.src = `${apiBase}/posts/${postId}/images/${i}`;
      img.alt = `共有された写真 ${i + 1}`;
      img.onerror = () => status(
        '写真を読み込めませんでした。画面を再読み込みしてください。',
        true
      );

      button.append(img);
      button.onclick = () => {
        $('large').src = img.src;
        $('lightbox').showModal();
      };
      $('gallery').append(button);
    }
    status('');
  } catch (e) {
    status(e.message, true);
    document.querySelector('.management').hidden = true;
  }
}

$('delete').onclick = async () => {
  const password = $('deletePassword').value;

  if (!password) {
    status('管理パスワードを入力してください。', true);
    $('deletePassword').focus();
    return;
  }

  if (!confirm('この投稿の写真をすべて削除します。元に戻せません。削除しますか？'))
    return;

  $('delete').disabled = true;

  try {
    await api(`/posts/${postId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${password}` }
    });

    $('lightbox').close();
    $('gallery').replaceChildren();
    document.querySelector('.management').hidden = true;
    status('この投稿を削除しました。');
  } catch (e) {
    status(e.message, true);
  } finally {
    $('delete').disabled = false;
  }
};

render();
if (postId !== null) view();
