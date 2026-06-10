import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:size-4 [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "bg-card text-foreground",
        info: "border-sky-200 bg-sky-50 text-sky-900 [&>svg]:text-sky-600 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200 dark:[&>svg]:text-sky-400",
        success:
          "border-emerald-200 bg-emerald-50 text-emerald-900 [&>svg]:text-emerald-600 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200 dark:[&>svg]:text-emerald-400",
        warning:
          "border-amber-200 bg-amber-50 text-amber-900 [&>svg]:text-amber-600 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200 dark:[&>svg]:text-amber-400",
        destructive:
          "border-destructive/30 bg-destructive/5 text-destructive [&>svg]:text-destructive"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-medium leading-none tracking-tight", className)}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
