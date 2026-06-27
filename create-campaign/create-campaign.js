(function () {
  var toggle = document.getElementById("menuToggle");
  var nav = document.getElementById("nav");

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Закрити меню" : "Відкрити меню");
    });

    nav.querySelectorAll(".nav__link").forEach(function (link) {
      link.addEventListener("click", function () {
        nav.classList.remove("is-open");
        toggle.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Відкрити меню");
      });
    });
  }

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

  var form = document.getElementById("campaignForm");
  var formError = document.getElementById("formError");
  var formSuccess = document.getElementById("formSuccess");
  var submitBtn = document.getElementById("submitBtn");

  if (!form) return;

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    if (formError) {
      formError.hidden = true;
      formError.textContent = "";
    }

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    var payload = {
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      advertise: form.advertise.value.trim(),
      budget: form.budget.value.trim(),
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "Надсилання…";

    fetch("/api/campaign-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.data.ok) {
          var message = "Не вдалося надіслати заявку. Спробуйте ще раз.";
          if (result.data && result.data.errors && result.data.errors.length) {
            message = result.data.errors.join(" ");
          } else if (result.data && result.data.error) {
            message = result.data.error;
          }
          throw new Error(message);
        }

        form.hidden = true;
        if (formSuccess) {
          formSuccess.hidden = false;
        }
      })
      .catch(function (err) {
        if (formError) {
          formError.hidden = false;
          formError.textContent = err.message || "Не вдалося надіслати заявку. Спробуйте ще раз.";
        }
        submitBtn.disabled = false;
        submitBtn.textContent = "Надіслати заявку";
      });
  });
})();
