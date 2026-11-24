// Yönetimdeki 'En çoklar' ve 'Larp raporu' görselleri: önizleme ölçeği, taşanı küçültme, PNG indir / paylaş.
  (function () {
    var card = document.getElementById('ig-card');
    if (!card) return;
    var stage = document.querySelector('.ig-stage'), scaleEl = document.querySelector('.ig-scale');
    var W = card.offsetWidth, H = card.offsetHeight;
    function fit() {
      var s = Math.min(1, stage.clientWidth / W);
      scaleEl.style.transform = 'scale(' + s + ')';
      stage.style.height = (H * s) + 'px';
    }
    // Taşarsa: önce başlığı, sonra sıralamadaki adları küçült
    function fitText() {
      var body = card.querySelector('.ig-body');
      function over() { return body.scrollHeight > body.clientHeight + 1; }
      function shrink(els, min) {
        els.forEach(function (el) {
          var size = parseFloat(getComputedStyle(el).fontSize);
          while ((el.scrollWidth > el.clientWidth + 1 || over()) && size > min) { size -= 4; el.style.fontSize = size + 'px'; }
        });
      }
      shrink(Array.prototype.slice.call(card.querySelectorAll('.ig-fit')), 56);
      var names = Array.prototype.slice.call(card.querySelectorAll('.ig-fit2'));
      var size = names.length ? parseFloat(getComputedStyle(names[0]).fontSize) : 0;
      while (names.length && over() && size > 34) { size -= 3; names.forEach(function (n) { n.style.fontSize = size + 'px'; }); }
      if (over()) { var b = card.querySelector('.ig-bubbles'); if (b) b.remove(); }
    }
    document.fonts.ready.then(function () { fitText(); H = card.offsetHeight; fit(); });
    window.addEventListener('resize', fit); fit();

    var fileName = card.dataset.file || 'howtolarp.png', blobP = null;
    function makeBlob() {
      blobP = blobP || document.fonts.ready.then(function () {
        return htmlToImage.toBlob(card, { pixelRatio: 1, width: W, height: card.offsetHeight, cacheBust: true });
      });
      blobP.catch(function () { blobP = null; });
      return blobP;
    }
    var shareBtn = document.getElementById('ig-share');
    if (shareBtn && navigator.canShare) {
      try {
        if (navigator.canShare({ files: [new File([new Blob(['x'])], 'a.png', { type: 'image/png' })] })) {
          shareBtn.hidden = false; document.getElementById('ig-share-hint').hidden = false;
          setTimeout(makeBlob, 800);
        }
      } catch (e) {}
    }
    if (shareBtn) shareBtn.addEventListener('click', function () {
      var text = document.getElementById('ig-caption').value;
      if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
      makeBlob().then(function (blob) {
        return navigator.share({ files: [new File([blob], fileName, { type: 'image/png' })], text: text });
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        alert('Paylaşım menüsü açılamadı. PNG indir düğmesiyle indirip paylaşabilirsin.');
      });
    });
    document.getElementById('ig-download').addEventListener('click', function () {
      var btn = this; btn.disabled = true; btn.textContent = 'Hazırlanıyor…';
      makeBlob().then(function (blob) {
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName; a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      }).catch(function () { alert('Görsel oluşturulamadı. Sayfayı yenileyip tekrar dene.'); })
        .finally(function () { btn.disabled = false; btn.textContent = 'PNG indir ↓'; });
    });
    var copyBtn = document.getElementById('ig-copy');
    copyBtn.addEventListener('click', function () {
      var t = document.getElementById('ig-caption').value;
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(
        function () { copyBtn.textContent = 'Kopyalandı ✓'; },
        function () { document.getElementById('ig-caption').select(); });
    });
  })();
