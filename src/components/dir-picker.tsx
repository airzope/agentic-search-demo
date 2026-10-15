"use client";

import { ArrowUpIcon, FolderIcon, HouseIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "@/components/app-providers";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/client";

type Listing = {
  path: string;
  parent: string | null;
  dirs: string[];
  files: number;
  home: string;
};

const join = (base: string, name: string) =>
  `${base.replace(/[\\/]+$/, "")}${base.includes("\\") && !base.includes("/") ? "\\" : "/"}${name}`;

/** Browse folders on the machine running the app and pick one. */
export function DirPicker({
  open,
  initialPath,
  onClose,
  onSelect,
}: {
  open: boolean;
  initialPath?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const { t } = useI18n();
  const [listing, setListing] = useState<Listing | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Only the latest request may update the listing.
  const latest = useRef(0);
  const load = useCallback(async (path?: string) => {
    const request = ++latest.current;
    setLoading(true);
    try {
      const next = await api<Listing>(
        `/api/fs${path ? `?path=${encodeURIComponent(path)}` : ""}`,
      );
      if (request !== latest.current) return;
      setListing(next);
      setTyped(next.path);
      setError(null);
    } catch (reason) {
      if (request === latest.current) setError(errorMessage(reason));
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Async loader: state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void load(initialPath || undefined);
  }, [open, initialPath, load]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogTitle>{t("fsb.title")}</DialogTitle>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void load(typed);
          }}
        >
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            className="font-mono text-xs md:text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t("fsb.up")}
            disabled={!listing?.parent}
            onClick={() => listing?.parent && void load(listing.parent)}
          >
            <ArrowUpIcon />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t("fsb.home")}
            onClick={() => void load(listing?.home)}
          >
            <HouseIcon />
          </Button>
        </form>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        <div className="h-72 overflow-y-auto rounded-lg border">
          {loading && !listing ? (
            <div className="text-muted-foreground flex items-center gap-2 p-3 text-sm">
              <Spinner /> {t("common.loading")}
            </div>
          ) : null}
          <ul className="flex flex-col p-1">
            {listing?.dirs.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => void load(join(listing.path, name))}
                  className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                >
                  <FolderIcon className="text-muted-foreground size-4 shrink-0" />
                  <span className="truncate">{name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter className="items-center">
          <span className="text-muted-foreground mr-auto text-xs">
            {listing ? t("fsb.files", { count: listing.files }) : null}
          </span>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!listing}
            onClick={() => listing && onSelect(listing.path)}
          >
            {t("fsb.select")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
