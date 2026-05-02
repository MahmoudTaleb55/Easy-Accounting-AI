import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Wiring regression net for task #290.
 *
 * Task #285 wired the AI assistant chat composer's image-upload button into
 * the same conservative auto-levels + JPEG-compression pipeline that the
 * in-dialog camera capture uses, via the shared helper
 * `client/src/lib/image-enhance.ts → enhanceAndCompressImageFile`.
 *
 * This test pins that wiring so a future refactor of `attachImageFile` in
 * `client/src/pages/ai-assistant.tsx` cannot quietly drop the call to
 * `enhanceAndCompressImageFile` on the upload branch and silently revert
 * the page to the old "raw FileReader.readAsDataURL" behaviour. Uploaded
 * receipts would otherwise just gradually get worse for OCR again with
 * nobody noticing in CI.
 *
 * The matching contract on the camera side is also pinned: when the camera
 * dialog hands a file in via `onCapture`, the chat composer passes
 * `alreadyEnhanced: true` and the helper must NOT be called a second time
 * (the dialog already ran the same pipeline before handing the file out, so
 * a redundant pass would just lossily recompress an already-optimised JPEG).
 */

// `vi.mock` is hoisted to the top of the file by vitest, which means any
// regular module-level `const` referenced inside the factory would not yet
// be initialised at hoist time. `vi.hoisted` is the supported escape hatch:
// it lifts the helper alongside the mock so the factory can close over it.
const { enhanceAndCompressImageFile } = vi.hoisted(() => ({
  // Lightweight stand-in for the shared enhancement helper. Returning a
  // real File means the downstream `FileReader.readAsDataURL(processed)`
  // call in `attachImageFile` still has something readable to work with —
  // the test only asserts which path the file took, not what the page
  // renders.
  enhanceAndCompressImageFile: vi.fn(
    async (f: File) =>
      new File([await f.arrayBuffer()], "enhanced-by-mock.jpg", {
        type: "image/jpeg",
      }),
  ),
}));

vi.mock("@/lib/image-enhance", () => ({
  enhanceAndCompressImageFile,
  // The page never imports these directly, but other modules under test do
  // (and a future change might). Provide harmless stubs so any incidental
  // import doesn't blow up the module graph.
  enhanceAndCompressDataUrl: vi.fn(),
  enhanceImageData: vi.fn(),
  dataUrlToImage: vi.fn(),
  canvasToBlob: vi.fn(),
}));

// The chat hooks pull in `fetch` against `/api/chat/...` which jsdom can't
// reach. We only care about the composer wiring, so stub them with the
// shape the component reads (`{ data, isLoading }` and
// `{ mutate, isPending }`).
vi.mock("@/hooks/use-chat", () => ({
  useChatMessages: () => ({ data: [], isLoading: false }),
  useSendMessage: () => ({ mutate: vi.fn(), isPending: false }),
}));

// `JournalEntryRefLink` triggers its own data fetches when rendered. The
// composer renders no journal references in the empty-chat state this test
// exercises, but we mock it defensively so a future render path that does
// can't break this spec.
vi.mock("@/components/journal/journal-entry-ref-link", () => ({
  JournalEntryRefLink: () => null,
}));

// Replace the camera dialog with a passive shim that records the latest
// `onCapture` callback the page wired into it. The camera-path test then
// invokes that callback directly to simulate the dialog completing a capture
// — sidestepping the real `react-webcam` / `getUserMedia` stack that does
// not work under jsdom.
const cameraDialogState: {
  onCapture: ((file: File) => void) | null;
} = { onCapture: null };

vi.mock("@/components/camera/camera-capture-dialog", () => ({
  CameraCaptureDialog: ({
    onCapture,
  }: {
    onCapture: (file: File) => void;
  }) => {
    cameraDialogState.onCapture = onCapture;
    return null;
  },
}));

import AiAssistant from "@/pages/ai-assistant";
import { LocaleProvider } from "@/contexts/locale-context";

function renderPage() {
  return render(
    <LocaleProvider>
      <AiAssistant />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  enhanceAndCompressImageFile.mockClear();
  cameraDialogState.onCapture = null;
});

afterEach(() => {
  cleanup();
});

describe("AiAssistant attachImageFile wiring", () => {
  test("uploaded image goes through the shared enhance/compress pipeline before being attached", async () => {
    // Spy on what the page eventually feeds to `FileReader.readAsDataURL`
    // so this test catches not just "the helper was called" but also the
    // sneakier regression where a future refactor calls the helper, ignores
    // its enhanced return value, and reads the original raw File instead.
    const readAsDataURLSpy = vi.spyOn(
      FileReader.prototype,
      "readAsDataURL",
    );

    const { getByTestId } = renderPage();

    const fileInput = getByTestId("input-file-upload") as HTMLInputElement;
    const uploaded = new File(
      [new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], // JFIF marker bytes
      "uploaded-receipt.jpg",
      { type: "image/jpeg" },
    );

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [uploaded] } });
    });

    await waitFor(() =>
      expect(enhanceAndCompressImageFile).toHaveBeenCalledTimes(1),
    );
    // The exact File the input received must be what the helper sees — if a
    // future refactor wraps the upload path in its own pre-processing, this
    // assertion forces the author to update the contract intentionally.
    expect(enhanceAndCompressImageFile).toHaveBeenCalledWith(uploaded);

    // The pipeline's *return value* — not the raw uploaded File — is what
    // gets attached to the message. The mock returns a File with name
    // `enhanced-by-mock.jpg`, so any code path that drops the enhanced
    // result and reads the raw `uploaded` File instead would surface as a
    // mismatched filename here.
    await waitFor(() => expect(readAsDataURLSpy).toHaveBeenCalledTimes(1));
    const attached = readAsDataURLSpy.mock.calls[0][0] as File;
    expect(attached.name).toBe("enhanced-by-mock.jpg");
    expect(attached).not.toBe(uploaded);

    readAsDataURLSpy.mockRestore();
  });

  test("camera-captured image is NOT re-processed (alreadyEnhanced short-circuit)", async () => {
    renderPage();

    // Mounting the page wires the camera dialog's `onCapture` prop into
    // our shim. If this is null the component tree changed in a way that
    // means this test no longer covers the camera path — fail loudly.
    expect(cameraDialogState.onCapture).toBeTruthy();

    const fromCamera = new File(
      [new Uint8Array([0xff, 0xd8, 0xff, 0xe0])],
      "camera-capture.jpg",
      { type: "image/jpeg" },
    );

    await act(async () => {
      cameraDialogState.onCapture!(fromCamera);
    });

    // Camera path passes `{ alreadyEnhanced: true }`. The helper must not
    // run again — a redundant pass would lossily recompress an already-
    // optimised JPEG that the dialog produced.
    expect(enhanceAndCompressImageFile).not.toHaveBeenCalled();
  });

  test("non-image uploads are rejected before the pipeline is invoked", async () => {
    const { getByTestId } = renderPage();
    const fileInput = getByTestId("input-file-upload") as HTMLInputElement;

    const notAnImage = new File(["plain text"], "notes.txt", {
      type: "text/plain",
    });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [notAnImage] } });
    });

    // The early `!file.type.startsWith("image/")` guard short-circuits and
    // never hands the file to the pipeline. This pins the early-return
    // contract so future copy/error-toast refactors don't accidentally let
    // arbitrary MIME types reach the JPEG compressor.
    expect(enhanceAndCompressImageFile).not.toHaveBeenCalled();
  });
});
