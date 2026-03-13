"use strict";

const { v2: cloudinary } = require("cloudinary");

const cloudName = process.env.CLOUDINARY_CLOUD_NAME || "";
const apiKey = process.env.CLOUDINARY_API_KEY || "";
const apiSecret = process.env.CLOUDINARY_API_SECRET || "";

if (cloudName && apiKey && apiSecret) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
}

function isCloudinaryConfigured() {
  return Boolean(cloudName && apiKey && apiSecret);
}

async function uploadProfileImageDataUrl(dataUrl, telegramId) {
  if (!isCloudinaryConfigured()) {
    throw new Error("Cloudinary is not configured");
  }
  const result = await cloudinary.uploader.upload(dataUrl, {
    folder: "clawmeet/profiles",
    public_id: `tg_${String(telegramId)}_${Date.now()}`,
    overwrite: true,
    resource_type: "image",
    transformation: [
      { width: 600, height: 600, crop: "limit" },
      { quality: "auto:good" },
      { fetch_format: "auto" },
    ],
  });

  return {
    secureUrl: result.secure_url,
    publicId: result.public_id,
  };
}

async function deleteImageByPublicId(publicId) {
  if (!publicId || !isCloudinaryConfigured()) return;
  await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
}

module.exports = {
  isCloudinaryConfigured,
  uploadProfileImageDataUrl,
  deleteImageByPublicId,
};
