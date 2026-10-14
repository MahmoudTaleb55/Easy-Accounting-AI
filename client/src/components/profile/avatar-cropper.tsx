import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { useT } from "@/i18n/dict";

const OUTPUT_SIZE = 512;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

type Props = {
  file: File | null;
  onCancel: () => void;
  onCropped: (file: File) => void;
};

export function AvatarCropper({ file, onCancel, onCropped }: Props) {
  const t = useT();
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setImageSrc(null);
      setCroppedAreaPixels(null);
      setIsProcessing(false);
      setError(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setImageSrc(url);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setIsProcessing(false);
    setError(null);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  async function handleConfirm() {
    if (!imageSrc || !croppedAreaPixels || !file) return;
    setIsProcessing(true);
    setError(null);
    try {
      const usePng = shouldEncodeAsPng(file.type);
      const { blob, mimeType, extension } = await getCroppedImage(
        imageSrc,
        croppedAreaPixels,
        usePng,
      );
      if (blob.size > MAX_OUTPUT_BYTES) {
        setError(t("avatar_too_large"));
        setIsProcessing(false);
        return;
      }
      const cropped = new File(
        [blob],
        renameWithExtension(file.name, extension),
        { type: mimeType },
      );
      setIsProcessing(false);
      onCropped(cropped);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setIsProcessing(false);
    }
  }

  return (
    <Dialog
      open={!!file}
      onOpenChange={(open) => {
        if (!open && !isProcessing) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="dialog-avatar-cropper">
        <DialogHeader>
          <DialogTitle>{t("avatar_crop_title")}</DialogTitle>
          <DialogDescription>
            {t("avatar_crop_desc")}
          </DialogDescription>
        </DialogHeader>

        <div
          className="relative h-64 w-full overflow-hidden rounded-md bg-muted"
          data-testid="region-avatar-cropper"
        >
          {imageSrc && (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              minZoom={1}
              maxZoom={4}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          )}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <ZoomOut className="h-4 w-4 text-muted-foreground" aria-hidden />
          <Slider
            value={[zoom]}
            min={1}
            max={4}
            step={0.05}
            onValueChange={(v) => setZoom(v[0] ?? 1)}
            data-testid="slider-avatar-zoom"
            aria-label={t("avatar_zoom")}
          />
          <ZoomIn className="h-4 w-4 text-muted-foreground" aria-hidden />
        </div>

        {error && (
          <p className="text-sm text-destructive" data-testid="error-avatar-cropper">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isProcessing}
            data-testid="button-cropper-cancel"
          >
            {t("avatar_cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isProcessing || !croppedAreaPixels}
            data-testid="button-cropper-confirm"
          >
            {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("avatar_use_photo")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const JPEG_QUALITY = 0.9;

function shouldEncodeAsPng(sourceType: string): boolean {
  const t = sourceType.toLowerCase();
  return t === "image/png" || t === "image/gif" || !t.startsWith("image/");
}

function renameWithExtension(name: string, extension: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${extension}`;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(typeof e === "string" ? e : "Failed to load image"));
    img.src = src;
  });
}

async function getCroppedImage(
  imageSrc: string,
  area: Area,
  usePng: boolean,
): Promise<{ blob: Blob; mimeType: string; extension: string }> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser");
  if (!usePng) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  }
  ctx.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    OUTPUT_SIZE,
    OUTPUT_SIZE,
  );
  const mimeType = usePng ? "image/png" : "image/jpeg";
  const extension = usePng ? "png" : "jpg";
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("Could not encode cropped image"));
      },
      mimeType,
      usePng ? undefined : JPEG_QUALITY,
    );
  });
  return { blob, mimeType, extension };
}
