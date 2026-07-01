const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PORT = "3461";

function request(method, urlPath, body, cookie) {
  return new Promise(function (resolve, reject) {
    const payload = body ? JSON.stringify(body) : null;
    const headers = {};
    if (body) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    if (cookie) {
      headers.Cookie = cookie;
    }

    const req = http.request(
      { hostname: "127.0.0.1", port: PORT, path: urlPath, method: method, headers: headers },
      function (res) {
        let raw = "";
        res.on("data", function (chunk) {
          raw += chunk;
        });
        res.on("end", function () {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: raw ? JSON.parse(raw) : {},
          });
        });
      }
    );

    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function getText(urlPath) {
  return new Promise(function (resolve, reject) {
    http
      .get("http://127.0.0.1:" + PORT + urlPath, function (res) {
        let raw = "";
        res.on("data", function (chunk) {
          raw += chunk;
        });
        res.on("end", function () {
          resolve({ status: res.statusCode, text: raw });
        });
      })
      .on("error", reject);
  });
}

function head(urlPath) {
  return new Promise(function (resolve, reject) {
    http
      .request({ hostname: "127.0.0.1", port: PORT, path: urlPath, method: "HEAD" }, function (res) {
        resolve({ status: res.statusCode });
      })
      .on("error", reject)
      .end();
  });
}

function extractCookie(setCookie) {
  if (!setCookie) {
    return "";
  }
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return value.split(";")[0];
}

async function main() {
  const server = spawn("node", ["server.js"], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: PORT }),
    stdio: "inherit",
  });

  await new Promise(function (resolve) {
    setTimeout(resolve, 800);
  });

  const email = "test-" + Date.now() + "@example.com";
  const register = await request("POST", "/api/auth/register", {
    name: "Test User",
    email: email,
    password: "password123",
    role: "publisher",
  });
  const cookie = extractCookie(register.headers["set-cookie"]);
  const me = await request("GET", "/api/auth/me", null, cookie);
  const logout = await request("POST", "/api/auth/logout", {}, cookie);
  const login = await request("POST", "/api/auth/login", {
    email: email,
    password: "password123",
  });
  const loginCookie = extractCookie(login.headers["set-cookie"]);
  const meAfterLogin = await request("GET", "/api/auth/me", null, loginCookie);
  const registerPage = await getText("/register");
  const brokenScript = await head("/register.js");
  const fixedScript = await head("/register/register.js");

  const checks = {
    registerOk: register.status === 201 && register.body.ok === true,
    autoSession: !!cookie,
    meOk: me.body.user && me.body.user.role === "publisher",
    noPasswordHash: !JSON.stringify(me.body).includes("passwordHash"),
    logoutOk: logout.body.ok === true,
    loginOk: login.body.ok === true,
    meAfterLogin: meAfterLogin.body.user.email === email,
    registerPageEn: registerPage.status === 200 && registerPage.text.includes("I want to buy advertising"),
    brokenRegisterJs404: brokenScript.status === 404,
    fixedRegisterJs200: fixedScript.status === 200,
    registerUsesAbsoluteScript: registerPage.text.includes('src="/register/register.js"'),
  };

  console.log(JSON.stringify(checks, null, 2));
  server.kill();

  const failed = Object.keys(checks).filter(function (key) {
    return !checks[key];
  });
  process.exit(failed.length ? 1 : 0);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
