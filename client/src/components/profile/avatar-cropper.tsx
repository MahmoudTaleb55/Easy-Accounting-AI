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

const OUTPUT_SIZE = 512;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

type Props = {
  file: File | null;
  ar: boolean;
  onCancel: () => void;
  onCropped: (file: File) => void;
};

export function AvatarCropper({ file, ar, onCancel, onCropped }: Props) {
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
    if (!imageSrc || !croppedAreaPixels) return;
    setIsProcessing(true);
    setError(null);
    try {
      const blob = await getCroppedPng(imageSrc, croppedAreaPixels);
      if (blob.size > MAX_OUTPUT_BYTES) {
        setError(
          ar
            ? "الصورة المقصوصة كبيرة جداً. جرّب تكبيراً أقل."
            : "Cropped image is too large. Try a smaller zoom."
        );
        setIsProcessing(false);
        return;
      }
      const cropped = new File([blob], renameToPng(file?.name ?? "avatar.png"), {
        type: "image/png",
      });
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
          <DialogTitle>{ar ? "اقتص الصورة" : "Crop your photo"}</DialogTitle>
          <DialogDescription>
            {ar
              ? "اسحب لتحريك الصورة واستخدم الشريط للتكبير. ستُحفظ مربعة."
              : "Drag to position and use the slider to zoom. The result is saved as a square."}
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
            aria-label={ar ? "تكبير" : "Zoom"}
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
            {ar ? "إلغاء" : "Cancel"}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isProcessing || !croppedAreaPixels}
            data-testid="button-cropper-confirm"
          >
            {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {ar ? "استخدم الصورة" : "Use photo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function renameToPng(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.png`;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(typeof e === "string" ? e : "Failed to load image"));
    img.src = src;
  });
}

async function getCroppedPng(imageSrc: string, area: Area): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser");
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
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not encode cropped image"));
      },
      "image/png",
    );
  });
}
