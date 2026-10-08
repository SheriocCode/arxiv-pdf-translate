(function () {
  var CHEVRON_LEFT =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
  var CHEVRON_RIGHT =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';

  function pad(n) { return (n < 9 ? "0" : "") + (n + 1); }

  function init(el) {
    var items = Array.prototype.slice.call(
      el.querySelectorAll(":scope > figure, :scope > img")
    );
    if (!items.length) return;

    var total = items.length;

    var stage = document.createElement("div");
    stage.className = "car-stage";
    items.forEach(function (it, i) {
      it.classList.add("car-item");
      var fc = it.querySelector("figcaption");
      if (fc) {
        var mark = document.createElement("span");
        mark.className = "car-index";
        mark.textContent = " · " + pad(i) + "/" + pad(total - 1);
        fc.appendChild(mark);
      }
      stage.appendChild(it);
    });
    el.appendChild(stage);

    var prev = document.createElement("button");
    prev.type = "button";
    prev.className = "car-nav car-prev";
    prev.setAttribute("aria-label", "上一张");
    prev.innerHTML = CHEVRON_LEFT;

    var next = document.createElement("button");
    next.type = "button";
    next.className = "car-nav car-next";
    next.setAttribute("aria-label", "下一张");
    next.innerHTML = CHEVRON_RIGHT;

    stage.appendChild(prev);
    stage.appendChild(next);

    var idx = 0;

    function show(i) {
      var n = items.length;
      idx = ((i % n) + n) % n;
      var p = (idx - 1 + n) % n;
      var q = (idx + 1) % n;
      items.forEach(function (it, k) {
        it.classList.toggle("is-active", k === idx);
        it.classList.toggle("is-prev", n > 2 && k === p);
        it.classList.toggle("is-next", n > 2 && k === q);
      });
    }

    prev.addEventListener("click", function () { show(idx - 1); });
    next.addEventListener("click", function () { show(idx + 1); });

    el.tabIndex = 0;
    el.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { show(idx - 1); e.preventDefault(); }
      else if (e.key === "ArrowRight") { show(idx + 1); e.preventDefault(); }
    });

    if (items.length <= 1) {
      prev.style.display = "none";
      next.style.display = "none";
    }
    show(0);
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".carousel").forEach(init);
  });
})();
