(function () {
  "use strict";

  var STRINGS = {
    en: {
      registerFailed: "Registration failed",
      registerRetry: "Registration failed. Please try again.",
      loginFailed: "Sign in failed",
      loginRetry: "Sign in failed. Please try again.",
      publisherWelcome:
        "Welcome to Vybridge. Here you will be able to add your advertising spaces.",
      advertiserWelcome:
        "Welcome to Vybridge. Here you will be able to find advertising spaces.",
    },
    uk: {
      registerFailed: "Реєстрація не вдалася",
      registerRetry: "Реєстрація не вдалася. Спробуйте ще раз.",
      loginFailed: "Вхід не вдався",
      loginRetry: "Вхід не вдався. Спробуйте ще раз.",
      publisherWelcome:
        "Ласкаво просимо до Vybridge. Тут ви зможете додати свої рекламні місця.",
      advertiserWelcome:
        "Ласкаво просимо до Vybridge. Тут ви зможете знайти рекламні місця.",
    },
  };

  var API_ERRORS = {
    uk: {
      "Name is required": "Імʼя обовʼязкове",
      "Email is required": "Email обовʼязковий",
      "Email is invalid": "Email недійсний",
      "Password is required": "Пароль обовʼязковий",
      "Password must be at least 8 characters": "Пароль має містити щонайменше 8 символів",
      "Role must be advertiser or publisher": "Роль має бути advertiser або publisher",
      "This email is already registered": "Цей email вже зареєстровано",
      "Invalid email or password": "Невірний email або пароль",
    },
  };

  function getLang() {
    var lang = (document.documentElement.lang || "en").toLowerCase();
    return lang === "uk" ? "uk" : "en";
  }

  function t(key) {
    var lang = getLang();
    return (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
  }

  function translateApiMessages(messages) {
    var lang = getLang();
    if (lang !== "uk") {
      return messages;
    }
    return messages.map(function (message) {
      return API_ERRORS.uk[message] || message;
    });
  }

  function isUkPath() {
    return window.location.pathname.indexOf("/uk/") === 0;
  }

  function authPath(path) {
    return (isUkPath() ? "/uk" : "") + path;
  }

  window.VybridgeI18n = {
    getLang: getLang,
    t: t,
    translateApiMessages: translateApiMessages,
    authPath: authPath,
  };
})();
