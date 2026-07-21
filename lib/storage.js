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
// it. So the URL actually stored on the model is built via cloudinary.url()
// (not result.secure_url) to get that real per-request negotiation — that's
// the whole point of fetch_format: auto.
const DELIVERY_TRANSFORMATION = [{ quality: "auto:good" }, { fetch_format: "auto" }];

// Uploads an image buffer to Cloudinary under the given folder and returns
// its delivery URL (plus the width/height Cloudinary measured). mimeType is
// accepted for the caller's own bookkeeping; Cloudinary sniffs the real
// format from the buffer's bytes rather than trusting a passed-in header.
function uploadImage({ buffer, mimeType, folder }) {
  ensureConfigured();

  return new Promise(function (resolve, reject) {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
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

        resolve({ secureUrl: secureUrl, publicId: result.public_id, width: result.width, height: result.height });
      }
    );

    uploadStream.end(buffer);
  });
}

// Thin, folder-pinned wrappers over uploadImage — kept as the two things any
// caller actually needs (lib/deals.js for ad creatives, lib/sites.js for
// Marketplace covers) so neither has to know or care about Cloudinary
// folder layout.
function uploadCreative({ buffer, mimeType }) {
  return uploadImage({ buffer: buffer, mimeType: mimeType, folder: "vybridge/creatives" });
}

function uploadSiteCover({ buffer, mimeType }) {
  return uploadImage({ buffer: buffer, mimeType: mimeType, folder: "vybridge/site-covers" });
}

function uploadSlotPreview({ buffer, mimeType }) {
  return uploadImage({ buffer: buffer, mimeType: mimeType, folder: "vybridge/slot-previews" });
}

// Deletes a Cloudinary asset by its public_id — the id must come from a
// prior upload response (result.public_id / this module's own `publicId`
// field), never parsed back out of a delivery URL, since a URL carries
// transformation segments (q_auto:good/f_auto, and any size variant
// coverImageVariant() adds) that aren't part of the id and would corrupt a
// naive extraction. Callers should treat this as best-effort cleanup: a
// failed delete here should never fail the request that triggered it (the
// DB has already moved on to the new/no cover either way), so this
// resolves/rejects on whatever Cloudinary returns and it's the caller's job
// to catch and log rather than propagate.
function deleteImage(publicId) {
  ensureConfigured();
  return cloudinary.uploader.destroy(publicId, { resource_type: "image" });
}

const VARIANT_WIDTHS = { thumbnail: 400, medium: 800, large: null };

// A stored delivery URL already looks like
// https://res.cloudinary.com/<cloud>/image/upload/q_auto:good/f_auto/<public_id>
// — layering an additional w_<n>,c_fill,g_auto step right after "/upload/"
// resizes it without needing the raw public_id kept around separately from
// the URL. "large" (or an unrecognized size) returns the URL unchanged —
// that's the original, un-resized delivery URL.
function coverImageVariant(url, size) {
  if (!url) {
    return url;
  }
  const width = VARIANT_WIDTHS[size];
  if (!width) {
    return url;
  }
  return url.replace("/upload/", "/upload/w_" + width + ",c_fill,g_auto/");
}

module.exports = {
  uploadImage: uploadImage,
  uploadCreative: uploadCreative,
  uploadSiteCover: uploadSiteCover,
  uploadSlotPreview: uploadSlotPreview,
  coverImageVariant: coverImageVariant,
  deleteImage: deleteImage,
};
