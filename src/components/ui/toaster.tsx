"use client";

import { Toast } from "@base-ui/react/toast";
import { CircleAlertIcon, CircleCheckIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** App-wide toast manager: `toast.add({ title, description, type })`. */
export const toast = Toast.createToastManager();

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((item) => (
    <Toast.Root
      key={item.id}
      toast={item}
      className={cn(
        "bg-popover text-popover-foreground ring-foreground/10 pointer-events-auto relative flex w-full items-start gap-2.5 rounded-xl p-3 pr-9 text-sm shadow-lg ring-1 transition-[opacity,translate] duration-300 data-ending-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0",
      )}
    >
      {item.type === "error" ? (
        <CircleAlertIcon className="text-destructive mt-0.5 size-4 shrink-0" />
      ) : (
        <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Toast.Title className="font-medium" />
        <Toast.Description className="text-muted-foreground wrap-break-word" />
      </div>
      <Toast.Close
        aria-label="Close"
        className="text-muted-foreground hover:text-foreground absolute top-2.5 right-2.5 rounded-md p-0.5"
      >
        <XIcon className="size-3.5" />
      </Toast.Close>
    </Toast.Root>
  ));
}

export function Toaster({ children }: { children: React.ReactNode }) {
  return (
    <Toast.Provider toastManager={toast} timeout={4000}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[calc(100vw-2rem)] flex-col gap-2 sm:w-96">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
