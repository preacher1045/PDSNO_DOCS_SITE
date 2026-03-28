(function () {
  "use strict";

  var LIGHTBOX_ID = "diagram-lightbox";
  var MIN_SCALE = 0.5;
  var MAX_SCALE = 4;
  var STEP = 0.2;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function isDiagramImage(img) {
    if (!img || !img.getAttribute) return false;
    var src = img.getAttribute("src") || "";
    if (src.indexOf("assets/images/") === -1) return false;
    if (src.indexOf("logo") !== -1) return false;
    if (src.indexOf("favicon") !== -1) return false;
    return true;
  }

  function ensureLightbox() {
    var existing = document.getElementById(LIGHTBOX_ID);
    if (existing) return existing;

    var root = document.createElement("div");
    root.id = LIGHTBOX_ID;
    root.className = "diagram-lightbox";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Diagram image preview");

    root.innerHTML =
      '<div class="diagram-lightbox__stage">' +
      '  <img class="diagram-lightbox__image" alt="Diagram preview" />' +
      '  <div class="diagram-lightbox__toolbar">' +
      '    <button class="diagram-lightbox__btn" data-action="zoom-out" aria-label="Zoom out">-</button>' +
      '    <button class="diagram-lightbox__btn" data-action="zoom-in" aria-label="Zoom in">+</button>' +
      '    <button class="diagram-lightbox__btn" data-action="reset" aria-label="Reset zoom">100%</button>' +
      '    <button class="diagram-lightbox__btn" data-action="close" aria-label="Close preview">x</button>' +
      '  </div>' +
      '  <div class="diagram-lightbox__hint">Mouse wheel to zoom, ESC to close</div>' +
      '</div>';

    document.body.appendChild(root);
    return root;
  }

  function install() {
    var lightbox = ensureLightbox();
    var stage = lightbox.querySelector(".diagram-lightbox__stage");
    var preview = lightbox.querySelector(".diagram-lightbox__image");
    var hint = lightbox.querySelector(".diagram-lightbox__hint");
    var scale = 1;
    var offsetX = 0;
    var offsetY = 0;
    var isDragging = false;
    var dragStartX = 0;
    var dragStartY = 0;
    var dragOriginX = 0;
    var dragOriginY = 0;

    function clampOffsets() {
      var scaledWidth = preview.offsetWidth * scale;
      var scaledHeight = preview.offsetHeight * scale;
      var maxX = Math.max(0, (scaledWidth - stage.clientWidth) / 2);
      var maxY = Math.max(0, (scaledHeight - stage.clientHeight) / 2);

      offsetX = clamp(offsetX, -maxX, maxX);
      offsetY = clamp(offsetY, -maxY, maxY);
    }

    function applyTransform() {
      clampOffsets();
      preview.style.transform =
        "translate(" + offsetX + "px, " + offsetY + "px) scale(" + scale + ")";

      if (scale > 1) {
        preview.style.cursor = isDragging ? "grabbing" : "grab";
        hint.textContent = "Drag to pan, wheel to zoom, ESC to close";
      } else {
        preview.style.cursor = "zoom-in";
        hint.textContent = "Mouse wheel to zoom, ESC to close";
      }
    }

    function applyScale(next) {
      scale = clamp(next, MIN_SCALE, MAX_SCALE);
      if (scale <= 1) {
        offsetX = 0;
        offsetY = 0;
      }
      applyTransform();
    }

    function open(src, alt) {
      preview.src = src;
      preview.alt = alt || "Diagram preview";
      offsetX = 0;
      offsetY = 0;
      applyScale(1);
      lightbox.classList.add("is-open");
      document.body.style.overflow = "hidden";
    }

    function close() {
      lightbox.classList.remove("is-open");
      document.body.style.overflow = "";
      preview.removeAttribute("src");
      isDragging = false;
    }

    document.querySelectorAll(".md-typeset img").forEach(function (img) {
      if (!isDiagramImage(img)) return;
      if (img.dataset.lightboxBound === "1") return;
      img.dataset.lightboxBound = "1";
      img.addEventListener("click", function () {
        open(img.getAttribute("src"), img.getAttribute("alt"));
      });
    });

    lightbox.addEventListener("click", function (ev) {
      if (ev.target === lightbox || ev.target.dataset.action === "close") {
        close();
      }
      if (ev.target.dataset.action === "zoom-in") {
        applyScale(scale + STEP);
      }
      if (ev.target.dataset.action === "zoom-out") {
        applyScale(scale - STEP);
      }
      if (ev.target.dataset.action === "reset") {
        offsetX = 0;
        offsetY = 0;
        applyScale(1);
      }
    });

    preview.addEventListener("pointerdown", function (ev) {
      if (scale <= 1) return;
      isDragging = true;
      dragStartX = ev.clientX;
      dragStartY = ev.clientY;
      dragOriginX = offsetX;
      dragOriginY = offsetY;
      preview.setPointerCapture(ev.pointerId);
      applyTransform();
      ev.preventDefault();
    });

    preview.addEventListener("pointermove", function (ev) {
      if (!isDragging) return;
      offsetX = dragOriginX + (ev.clientX - dragStartX);
      offsetY = dragOriginY + (ev.clientY - dragStartY);
      applyTransform();
      ev.preventDefault();
    });

    preview.addEventListener("pointerup", function (ev) {
      if (!isDragging) return;
      isDragging = false;
      preview.releasePointerCapture(ev.pointerId);
      applyTransform();
    });

    preview.addEventListener("pointercancel", function () {
      isDragging = false;
      applyTransform();
    });

    lightbox.addEventListener(
      "wheel",
      function (ev) {
        if (!lightbox.classList.contains("is-open")) return;
        ev.preventDefault();
        var delta = ev.deltaY > 0 ? -STEP : STEP;
        applyScale(scale + delta);
      },
      { passive: false }
    );

    window.addEventListener("resize", function () {
      if (!lightbox.classList.contains("is-open")) return;
      applyTransform();
    });

    document.addEventListener("keydown", function (ev) {
      if (!lightbox.classList.contains("is-open")) return;
      if (ev.key === "Escape") close();
      if (ev.key === "+" || ev.key === "=") applyScale(scale + STEP);
      if (ev.key === "-") applyScale(scale - STEP);
      if (ev.key === "0") applyScale(1);
    });
  }

  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(function () {
      install();
    });
  } else {
    document.addEventListener("DOMContentLoaded", install);
  }
})();
