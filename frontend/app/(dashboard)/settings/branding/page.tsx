"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Palette, Save } from "lucide-react";
import { productizationApi } from "@/lib/productization";
import { qk } from "@/lib/query-keys";

type BrandPatch = {
  brandPrimaryColor: string | null;
  brandAccentColor: string | null;
  brandSlogan: string | null;
  brandReceiptFooter: string | null;
};

// ---------------------------------------------------------------------------
// /settings/branding — Phase 23 Section 3.
//
// Per-school brand editor. Live preview at the top reads the current
// form state (not the persisted state) so the operator sees their
// change before clicking Save. Reset clears the persisted overrides
// (deployment-level brand takes over).
//
// Color inputs use the native <input type="color"> for a built-in
// picker. Slogan + receipt footer are plain text.
// ---------------------------------------------------------------------------

type Form = {
  brandPrimaryColor: string;
  brandAccentColor: string;
  brandSlogan: string;
  brandReceiptFooter: string;
};

export default function BrandingPage() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: qk.productization.branding,
    queryFn: () => productizationApi.getBranding(),
  });
  const save = useMutation({
    mutationFn: (input: BrandPatch) => productizationApi.setBranding(input),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: qk.productization.branding }),
  });

  const [form, setForm] = React.useState<Form | null>(null);

  // Seed the form once data lands.
  React.useEffect(() => {
    if (!query.data || form) return;
    setForm({
      brandPrimaryColor: query.data.primaryColor,
      brandAccentColor: query.data.accentColor,
      brandSlogan: query.data.slogan ?? "",
      brandReceiptFooter: query.data.receiptFooter ?? "",
    });
  }, [query.data, form]);

  if (query.isLoading || !form || !query.data) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  const brand = query.data;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Settings
        </p>
        <h1 className="text-2xl font-semibold mt-1">Branding</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Customize the colors and copy that appear on receipts, report
          cards, and the dashboard. Leave any field blank to fall back
          to the platform default.
        </p>
      </div>

      <BrandPreview
        appName={brand.appName}
        primaryColor={form.brandPrimaryColor}
        accentColor={form.brandAccentColor}
        slogan={form.brandSlogan || brand.slogan || ""}
        logoUrl={brand.logoUrl}
      />

      <form
        className="rounded-xl border bg-card p-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({
            brandPrimaryColor: form.brandPrimaryColor || null,
            brandAccentColor: form.brandAccentColor || null,
            brandSlogan: form.brandSlogan || null,
            brandReceiptFooter: form.brandReceiptFooter || null,
          });
        }}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ColorField
            label="Primary color"
            value={form.brandPrimaryColor}
            onChange={(v) => setForm({ ...form, brandPrimaryColor: v })}
          />
          <ColorField
            label="Accent color"
            value={form.brandAccentColor}
            onChange={(v) => setForm({ ...form, brandAccentColor: v })}
          />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Slogan
          </label>
          <input
            type="text"
            value={form.brandSlogan}
            maxLength={160}
            onChange={(e) =>
              setForm({ ...form, brandSlogan: e.target.value })
            }
            placeholder="Educating tomorrow's leaders"
            className="mt-1 w-full h-9 rounded-md border border-input bg-card px-2 text-sm"
          />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Receipt footer
          </label>
          <textarea
            value={form.brandReceiptFooter}
            maxLength={500}
            rows={3}
            onChange={(e) =>
              setForm({ ...form, brandReceiptFooter: e.target.value })
            }
            placeholder="Tax registration number, fine print, etc. Shown at the bottom of every printed receipt."
            className="mt-1 w-full rounded-md border border-input bg-card px-2 py-1.5 text-sm"
          />
        </div>
        <div className="flex items-center justify-between gap-3 pt-2 border-t">
          <p className="text-[11px] text-muted-foreground">
            {brand.isCustomized
              ? "Custom branding active for this school."
              : "Using platform defaults — no overrides set."}
          </p>
          <button
            type="submit"
            disabled={save.isPending}
            className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {save.isPending ? "Saving…" : "Save branding"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-14 rounded-md border border-input bg-card cursor-pointer"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-32 rounded-md border border-input bg-card px-2 text-sm font-mono"
          maxLength={7}
        />
      </div>
    </div>
  );
}

function BrandPreview({
  appName,
  primaryColor,
  accentColor,
  slogan,
  logoUrl,
}: {
  appName: string;
  primaryColor: string;
  accentColor: string;
  slogan: string;
  logoUrl: string | null;
}) {
  return (
    <div
      className="rounded-xl border p-5 text-white"
      style={{
        background: `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)`,
      }}
    >
      <div className="flex items-center gap-3">
        <Palette className="h-4 w-4 opacity-80" />
        <p className="text-[11px] font-bold uppercase tracking-wider opacity-80">
          Live preview
        </p>
      </div>
      <div className="mt-3 flex items-center gap-3">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt="logo"
            className="h-10 w-10 rounded-md bg-white/20 object-contain"
          />
        ) : (
          <div className="h-10 w-10 rounded-md bg-white/20 flex items-center justify-center text-base font-bold">
            {appName.charAt(0)}
          </div>
        )}
        <div>
          <p className="text-lg font-semibold">{appName}</p>
          {slogan && <p className="text-xs opacity-80">{slogan}</p>}
        </div>
      </div>
    </div>
  );
}
