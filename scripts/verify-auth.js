const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PORT = "3460";

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
  const duplicate = await request("POST", "/api/auth/register", {
    name: "Test User",
    email: email,
    password: "password123",
    role: "publisher",
  });
  const cookie = extractCookie(duplicate.headers["set-cookie"]);
  const me = await request("GET", "/api/auth/me", null, cookie);
  const dupAgain = await request("POST", "/api/auth/register", {
    name: "Other",
    email: email,
    password: "password123",
    role: "advertiser",
  });
  const shortPass = await request("POST", "/api/auth/register", {
    name: "Bad",
    email: "bad@example.com",
    password: "short",
    role: "advertiser",
  });
  const logout = await request("POST", "/api/auth/logout", {}, cookie);
  const login = await request("POST", "/api/auth/login", {
    email: email,
    password: "password123",
  });
  const loginCookie = extractCookie(login.headers["set-cookie"]);
  const meAfterLogin = await request("GET", "/api/auth/me", null, loginCookie);
  const registerPage = await getText("/register");
  const loginPage = await getText("/login");
  const dashboardPage = await getText("/dashboard");

  const checks = {
    registerOk: duplicate.status === 201 && duplicate.body.ok === true,
    autoSession: !!cookie,
    meOk: me.body.user && me.body.user.role === "publisher",
    noPasswordHash: !JSON.stringify(me.body).includes("passwordHash"),
    duplicateBlocked: dupAgain.status === 400,
    shortPasswordBlocked: shortPass.status === 400,
    logoutOk: logout.body.ok === true,
    loginOk: login.body.ok === true,
    meAfterLogin: meAfterLogin.body.user.email === email,
    registerPageOk: registerPage.status === 200 && registerPage.text.includes("Chcem kúpiť reklamu"),
    loginPageOk: loginPage.status === 200,
    dashboardPageOk: dashboardPage.status === 200 && dashboardPage.text.includes("Vitajte vo Vybridge"),
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
