"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";

import { cn } from "@/lib/utils";

function Slider({ className, ...props }: SliderPrimitive.Root.Props) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("w-full touch-none select-none", className)}
      {...props}
    >
      <SliderPrimitive.Control className="flex h-5 w-full items-center">
        <SliderPrimitive.Track className="bg-muted relative h-1.5 w-full rounded-full">
          <SliderPrimitive.Indicator className="bg-primary rounded-full" />
          <SliderPrimitive.Thumb className="border-primary bg-background focus-visible:ring-ring/50 block size-4 rounded-full border-2 shadow-sm outline-none focus-visible:ring-3" />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
