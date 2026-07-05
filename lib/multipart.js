const Busboy = require("busboy");

const MAX_CREATIVE_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_CREATIVE_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

// Parses a single multipart/form-data request into plain text fields plus
// (at most) one uploaded file, buffered fully in memory — creatives are
// capped at 2MB (enforced here via busboy's own stream limit, not just a
// post-hoc length check) so this never needs to stream to disk.
//
// Resolves even when the file is missing or over the size limit — the
// caller decides what that means (missing upload vs. rejected upload)
// rather than this module throwing for an otherwise well-formed request.
function parseMultipart(req) {
  return new Promise(function (resolve, reject) {
    let busboy;
    try {
      busboy = Busboy({ headers: req.headers, limits: { fileSize: MAX_CREATIVE_FILE_SIZE, files: 1 } });
    } catch (err) {
      reject(err);
      return;
    }

    const fields = {};
    let file = null;
    let fileTooLarge = false;
    let settled = false;

    function fail(err) {
      if (settled) {
        return;
      }
      settled = true;
      reject(err);
    }

    busboy.on("field", function (name, value) {
      fields[name] = value;
    });

    busboy.on("file", function (name, stream, info) {
      const chunks = [];

      stream.on("data", function (chunk) {
        chunks.push(chunk);
      });
      stream.on("limit", function () {
        fileTooLarge = true;
      });
      stream.on("end", function () {
        if (!fileTooLarge) {
          file = { fieldName: name, buffer: Buffer.concat(chunks), mimeType: info.mimeType };
        }
      });
    });

    busboy.on("error", fail);
    req.on("error", fail);

    // busboy emits 'close' when it's done parsing (not 'finish').
    busboy.on("close", function () {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ fields: fields, file: file, fileTooLarge: fileTooLarge });
    });

    req.pipe(busboy);
  });
}

module.exports = {
  parseMultipart: parseMultipart,
  MAX_CREATIVE_FILE_SIZE: MAX_CREATIVE_FILE_SIZE,
  ALLOWED_CREATIVE_MIME_TYPES: ALLOWED_CREATIVE_MIME_TYPES,
};
