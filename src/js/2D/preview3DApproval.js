// The Extra 3D panel's Request confirmation. Almost all of it is caseNote.js's approval
// dialog, imported so the two read as one flow.
//
// Only three things differ: the left panel holds captures taken with the tab's camera
// button (nothing is automatic), the mail links to the 3D viewer, and there is no separate
// Send button — this dialog confirms with "Send", which mails the same people.

import { confirmModal, toast } from "../shared/toast.js";
import { getLoggedInUser } from "../shared/api.js";
import { createSharedThreeDViewerUrl } from "../shared/caseLinks.js";
import {
  buildAttachmentsSection,
  buildEmailSection,
  buildRecipientsSection,
  buildShotsSection,
  resolveCaseLabel,
  sendCaseEmails,
} from "./caseNote.js";

// This dialog's subject line. The 2D approval sends the case on its own (see
// sendCaseEmails' default); here the case is 3D-ready, and the mail says so.
const subjectFor = (caseIntID) => `${resolveCaseLabel(caseIntID)} 3D Ready`;

// Signs the message when the sender leaves From empty.
const LAB_SIGNATURE = "TRI Dental";

// One labelled text row appended to `parent`; returns the input to read later.
function shareField(parent, labelText, placeholder, value) {
  const row = el("label", "cn-share-field");
  row.appendChild(el("span", null, labelText));
  const input = document.createElement("input");
  input.type = "text";
  input.className = "cn-share-field-input";
  input.placeholder = placeholder;
  input.value = value || "";
  row.appendChild(input);
  parent.appendChild(row);
  return input;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Puts the picture on the clipboard. Pasting it into a chat that already has the
// message typed turns that message into the picture's caption.
async function copyImageToClipboard(dataUrl) {
  if (!dataUrl || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") return false;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return true;
  } catch (err) {
    console.warn("[preview3DApproval] image clipboard copy failed", err);
    return false;
  }
}

// Pick one capture and how much text goes with it, then copy both to the clipboard.
// Share sheets are avoided — WhatsApp Desktop prints the temp file path into the caption.
function buildSharePanel(caseIntID, shots, sharedLink, { caseName = "", ownerName = "" } = {}) {
  const section = el("section", "cn-approve-section cn-share is-hidden");
  section.appendChild(el("h4", "cn-approve-section-title", "Share"));

  const link = () => sharedLink;
  let pickedArch = shots?.upper ? "upper" : shots?.lower ? "lower" : null;
  let format = "message";

  // One capture only: what is shared is a single picture, not an album.
  const thumbs = el("div", "cn-share-thumbs");
  for (const [arch, label] of [["upper", "Upper"], ["lower", "Lower"]]) {
    const tile = el("label", "cn-share-thumb");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "cn-share-thumb";
    radio.checked = pickedArch === arch;
    radio.disabled = !shots?.[arch];
    radio.addEventListener("change", () => {
      if (radio.checked) pickedArch = arch;
    });
    tile.appendChild(radio);
    if (shots?.[arch]) {
      const img = document.createElement("img");
      img.src = shots[arch];
      img.alt = `${label} 3D capture`;
      tile.appendChild(img);
    } else {
      tile.appendChild(el("span", "cn-share-thumb-empty", "None"));
    }
    tile.appendChild(el("span", "cn-share-thumb-label", label));
    thumbs.appendChild(tile);
  }
  section.appendChild(thumbs);

  // Free text on both sides: neither the person it goes to on WhatsApp nor the
  // one sending it is necessarily one of the case's registered users.
  const toInput = shareField(section, "To", "Dr name", ownerName);
  const fromInput = shareField(
    section,
    "From",
    LAB_SIGNATURE,
    getLoggedInUser()?.username || ""
  );

  const formats = el("div", "cn-share-formats");
  for (const [value, label] of [["message", "Full message"], ["link", "Link only"]]) {
    const choice = el("label", "cn-share-format");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "cn-share-format";
    radio.checked = format === value;
    radio.addEventListener("change", () => {
      if (radio.checked) format = value;
    });
    choice.appendChild(radio);
    choice.appendChild(el("span", null, label));
    formats.appendChild(choice);
  }
  section.appendChild(formats);

  const hint = el("p", "cn-share-hint");
  hint.setAttribute("aria-live", "polite");

  const caseLabel = () => caseName || resolveCaseLabel(caseIntID);

  // The wording the lab sends by hand today.
  const messageLines = () => {
    const who = toInput.value.trim();
    const from = fromInput.value.trim() || LAB_SIGNATURE;
    return [
      who ? `Hi Dr ${who},` : "Hi,",
      `Case: ${caseLabel()}`,
      "",
      "Here's the link to your case:",
      link(),
      "",
      "Ok to proceed?",
      "",
      "Thank you.",
      `-${from}`,
    ];
  };

  const messageText = () => (format === "link" ? link() : messageLines().join("\n"));

  const apps = el("div", "cn-share-apps");

  // Paste order matters: the picture goes in last, so paste the message first and
  // WhatsApp carries it into the media preview's caption box.
  const imageBtn = el("button", "cn-share-app cn-share-app--image");
  imageBtn.type = "button";
  imageBtn.innerHTML = '<i class="fa fa-image" aria-hidden="true"></i><span>Copy image</span>';
  imageBtn.addEventListener("click", async () => {
    if (!pickedArch || !shots?.[pickedArch]) {
      toast.error("No capture to copy — take one on the Extra 3D tab.");
      return;
    }
    if (await copyImageToClipboard(shots[pickedArch])) {
      toast.success("Image copied.");
      hint.textContent = "Paste the message into the chat first, then the image — it becomes the caption.";
    } else {
      toast.error("Couldn't copy the image.");
    }
  });
  apps.appendChild(imageBtn);

  const copyBtn = el("button", "cn-share-app cn-share-app--copy");
  copyBtn.type = "button";
  copyBtn.innerHTML = '<i class="fa fa-copy" aria-hidden="true"></i><span>Copy message</span>';
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(messageText());
      toast.success("Message copied.");
      hint.textContent = "Paste it into the chat, then paste the image to caption it.";
    } catch (err) {
      console.warn("[preview3DApproval] copy failed", err);
      toast.error("Couldn't copy the message.");
    }
  });
  apps.appendChild(copyBtn);

  section.appendChild(apps);
  section.appendChild(hint);
  return section;
}

// Share sits beside Cancel and opens the panel above, rather than sharing on the
// spot: the user picks the capture and the wording first.
function buildShareButton(panel) {
  const btn = el("button", "app-confirm-btn cn-approve-share");
  btn.type = "button";
  btn.title = "Share the 3D viewer link";
  btn.innerHTML = '<i class="fa fa-share-nodes" aria-hidden="true"></i><span>Share</span>';
  btn.addEventListener("click", () => {
    const open = panel.classList.toggle("is-hidden");
    btn.setAttribute("aria-expanded", open ? "false" : "true");
    if (!open) panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  btn.setAttribute("aria-expanded", "false");
  return btn;
}

// The dialog's two captures as mail attachments. An arch that was never captured
// is simply left out rather than sent as an empty image.
function shotAttachments(shots) {
  return [
    { src: shots?.upper, alt: "Upper 3D capture" },
    { src: shots?.lower, alt: "Lower 3D capture" },
  ].filter((image) => !!image.src);
}

// caseNote's shared sender pointed at the 3D viewer. `forShare` rewrites a localhost dev
// URL to the live host; `images` is what the dialog handed back. Returns the sent count.
export async function sendApprovalEmails(caseIntID, recipients, images) {
  const link = await createSharedThreeDViewerUrl(caseIntID);
  return sendCaseEmails(caseIntID, recipients, {
    link,
    images,
    subject: subjectFor(caseIntID),
  });
}

// Resolves { confirmed, recipients, images }, not a boolean: the caller mails those
// addresses only once the status write lands, so a failed request is never sent.
export async function confirmPreview3DApproval({
  caseIntID,
  shots = null,
  // Only the share message uses these: the case's own name and the owner the
  // greeting is prefilled with.
  caseName = "",
  ownerName = "",
} = {}) {
  const sharedLink = await createSharedThreeDViewerUrl(caseIntID);
  const content = el("div", "cn-approve");

  // Files reviewed on the left, who to tell on the right — the same split the 2D
  // dialog uses, so the render stays in view while the notification is written.
  const cols = el("div", "cn-approve-cols");
  const renders = buildShotsSection(shots, { title: "3D captures", noun: "capture" });
  const uploads = buildAttachmentsSection();
  const main = el("div", "cn-approve-main");
  main.appendChild(renders.section);
  main.appendChild(uploads.section);
  cols.appendChild(main);

  // Ticked renders first, then uploads in the order added. Read at SEND time, so either
  // can change without reopening the dialog.
  const images = () => [...shotAttachments(renders.selectedShots()), ...uploads.attachments()];

  const recipients = buildRecipientsSection(caseIntID);
  const email = buildEmailSection({
    caseIntID,
    selectedRecipients: recipients.selectedRecipients,
    images,
    link: () => sharedLink,
    subject: subjectFor(caseIntID),
    // Confirming with "Send" already mails these people.
    sendButton: false,
  });
  const side = el("div", "cn-approve-side");
  side.appendChild(recipients.section);
  side.appendChild(email.section);
  cols.appendChild(side);

  content.appendChild(cols);

  // Folded away under the Share button until asked for, so the dialog still opens
  // on the request itself.
  const sharePanel = buildSharePanel(caseIntID, shots, sharedLink, { caseName, ownerName });
  content.appendChild(sharePanel);

  // Red, and reads as an aside: it says who the dialog is for, not what it does — a lab
  // user requests the approval, the clinician gives it.
  const title = el("span", null, "Request 3D Approval ");
  title.appendChild(el("span", "cn-approve-title-note", "[For Lab Only]"));

  const confirmed = await confirmModal({
    title,
    confirmText: "Send",
    cancelText: "Cancel",
    variant: "warning",
    size: "lg",
    content,
    actionsExtra: buildShareButton(sharePanel),
  });

  // Read the ticks and uploads before the dialog's DOM goes away, and only when
  // confirming — cancelling sends nothing.
  return {
    confirmed,
    recipients: confirmed ? email.pendingRecipients() : [],
    images: confirmed ? images() : [],
  };
}
