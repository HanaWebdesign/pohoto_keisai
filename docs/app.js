// 写真を保存用に縮小する
async function preparePhoto(file) {
  const source = URL.createObjectURL(file);
  const img = new Image();
  img.src = source;

  try {
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight)
      throw new Error("読み込めない写真です。");

    const canvas = document.createElement("canvas");
    let scale = Math.min(
      1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)
    );

    for (let attempt = 0; attempt < 5; attempt++) {
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("写真を縮小できませんでした。");

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      for (const quality of [0.85, 0.7, 0.55]) {
        const blob = await new Promise(resolve =>
          canvas.toBlob(resolve, "image/jpeg", quality)
        );
        if (blob && blob.size <= 1000000) {
          const photo = new File([blob], "photo.jpg", {
            type: "image/jpeg"
          });
          return { file: photo, url: URL.createObjectURL(photo) };
        }
      }
      scale *= 0.75;
    }
    throw new Error("写真を縮小できませんでした。別の写真を選んでください。");
  } finally {
    URL.revokeObjectURL(source);
    img.src = "";
  }
}

// 写真選択処理を、自動縮小付きに更新する
async function addFiles(list) {
  if (busy || selecting) return;

  const files = Array.from(list);
  if (photos.length + files.length > 4) {
    status("写真は4枚まで掲載できます。", true);
    return;
  }
  if (!files.length) return;

  const additions = [];
  selecting = true;
  render();
  status("写真を準備しています…");

  try {
    for (const file of files) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
        throw new Error("JPEG・PNG・WebPの写真だけ選べます。");
      if (!file.size || file.size > 8 * 1024 * 1024)
        throw new Error("元の写真は1枚8MBまでです。");

      additions.push(await preparePhoto(file));
    }
    photos.push(...additions);
    status("写真を確認して、アップロードを押してね。");
  } catch (e) {
    additions.forEach(p => URL.revokeObjectURL(p.url));
    status(e.message || "写真を読み込めませんでした。", true);
  } finally {
    selecting = false;
    render();
  }
}
