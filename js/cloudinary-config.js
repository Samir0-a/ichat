/* =========================================================
   I-Chat — Cloudinary Configuration
   Used for profile picture uploads (unsigned upload preset).

   Setup:
   1. cloudinary.com → Dashboard → copy your "Cloud name"
   2. Settings → Upload → Upload presets → Add upload preset
      → Signing Mode: "Unsigned" → Save → copy the preset name
   3. Paste both values below.
   4. Recommended: in that preset, restrict "Folder" to
      "profile-pictures" and enable an allowed formats /
      max file size limit so the unsigned preset can't be abused.
   ========================================================= */

export const CLOUDINARY_CLOUD_NAME = "aakqzrnn";
export const CLOUDINARY_UPLOAD_PRESET = "profile-pictures";

/**
 * Uploads a single image file to Cloudinary using an unsigned upload preset
 * and resolves with the resulting secure (https) URL.
 */
export async function uploadToCloudinary(file, folder = "profile-pictures") {
  if (!file) return "";

  if (CLOUDINARY_CLOUD_NAME === "YOUR_CLOUD_NAME") {
    throw new Error("Cloudinary isn't configured yet — set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET in js/cloudinary-config.js.");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  formData.append("folder", folder);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: "POST",
    body: formData
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || "Image upload failed. Please try again.");
  }

  const data = await res.json();
  return data.secure_url;
}
