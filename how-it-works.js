(function () {
  var toggle = document.getElementById("menuToggle");
  var nav = document.getElementById("nav");

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });

    nav.querySelectorAll(".nav__link").forEach(function (link) {
      link.addEventListener("click", function () {
        nav.classList.remove("is-open");
        toggle.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open menu");
      });
    });
  }

  var faqButtons = document.querySelectorAll(".faq-item__button");

  faqButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      var item = button.closest(".faq-item");
      if (!item) return;

      var content = item.querySelector(".faq-item__content");
      var isOpen = item.classList.contains("is-open");

      faqButtons.forEach(function (otherButton) {
        var otherItem = otherButton.closest(".faq-item");
        if (!otherItem) return;
        var otherContent = otherItem.querySelector(".faq-item__content");
        otherItem.classList.remove("is-open");
        otherButton.setAttribute("aria-expanded", "false");
        if (otherContent) otherContent.style.maxHeight = "0px";
      });

      if (!isOpen) {
        item.classList.add("is-open");
        button.setAttribute("aria-expanded", "true");
        if (content) content.style.maxHeight = content.scrollHeight + "px";
      }
    });
  });

  var revealElements = document.querySelectorAll(".reveal");

  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    revealElements.forEach(function (element) {
      observer.observe(element);
    });
  } else {
    revealElements.forEach(function (element) {
      element.classList.add("in-view");
    });
  }
})();
