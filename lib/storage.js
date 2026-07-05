const cloudinary = require("cloudinary").v2;

let configured = false;

// Configuring cloudinary is cheap and idempotent, but there's no reason to
// re-read process.env on every upload — done once, lazily, on first use.
function ensureConfigured() {
  if (configured) {
    return;
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  // A creative that silently fails to upload is a booked, paid deal with no
  // ad to ever show — that must surface as a hard failure (a 500 from
  // createDeal, before any money moves), never a quietly-broken image URL.
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "Cloudinary is not configured — set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET"
    );
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  });
  configured = true;
}

// { quality: 'auto:good' } + { fetch_format: 'auto' }, applied both at
// upload time and again below in the delivery URL. Passed to the upload
// call as specified, and it does compress the stored asset — but
// fetch_format: auto can only ever choose per REQUEST (WebP for a browser
// that supports it, otherwise not), and an incoming/upload-time
// transformation freezes to one format at upload time. Verified directly:
// the plain secure_url the upload API returns serves image/png regardless
// of the request's Accept header, while a URL with q_auto:good/f_auto
// baked into its path correctly serves image/webp when the client accepts
// it. So the URL actually stored on the Creative row is built via
// cloudinary.url() (not result.secure_url) to get that real per-request
// negotiation — that's the whole point of fetch_format: auto.
const DELIVERY_TRANSFORMATION = [{ quality: "auto:good" }, { fetch_format: "auto" }];

// Uploads a creative image buffer to Cloudinary and returns its delivery
// URL (plus the width/height Cloudinary measured — createDeal needs those
// for the Creative row, so the client no longer has to read them itself).
// mimeType is accepted for the caller's own bookkeeping; Cloudinary sniffs
// the real format from the buffer's bytes rather than trusting a
// passed-in header.
function uploadCreative({ buffer, mimeType }) {
  ensureConfigured();

  return new Promise(function (resolve, reject) {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "vybridge/creatives",
        transformation: DELIVERY_TRANSFORMATION,
        resource_type: "image",
      },
      function (err, result) {
        if (err) {
          reject(err);
          return;
        }

        const secureUrl = cloudinary.url(result.public_id, {
          secure: true,
          resource_type: "image",
          transformation: DELIVERY_TRANSFORMATION,
        });

        resolve({ secureUrl: secureUrl, width: result.width, height: result.height });
      }
    );

    uploadStream.end(buffer);
  });
}

module.exports = {
  uploadCreative: uploadCreative,
};
