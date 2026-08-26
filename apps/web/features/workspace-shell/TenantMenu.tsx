"use client";

import { useRef } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Check, ChevronDown, LogOut, User } from "lucide-react";
import { Avatar, Badge } from "@hexagen/ui";
import { useAppSession } from "../account-onboarding/useAppSession";
import { useTenantOptional } from "@/contexts/TenantContext";

/**
 * Compact tenant switcher for the desktop header (P-U5): the current tenant
 * (personal, or one org) with a `<details>` dropdown listing Personal + each
 * org membership, then Account / Sign out.
 *
 * Same native-`<details>` mechanism as HeaderMenu — deliberately no new menu
 * system. Renders nothing unless the session is authenticated AND a
 * TenantProvider is mounted (the wizard's ProjectWorkspace renders Header
 * outside WorkspaceChrome, so the provider can legitimately be absent).
 */
export function TenantMenu() {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const { status, user } = useAppSession();
  const tenant = useTenantOptional();

  if (status !== "authenticated" || !tenant) return null;

  const { activeTenantId, orgs, selectTenant } = tenant;
  const personalName = user?.login ?? user?.name ?? "Personal";
  const activeOrg = orgs.find((org) => org.id === activeTenantId) ?? null;
  const currentName = activeOrg ? activeOrg.name : personalName;

  const closeMenu = () => {
    menuRef.current?.removeAttribute("open");
  };

  const handleSelect = (id: string | null) => {
    selectTenant(id);
    closeMenu();
  };

  return (
    <details ref={menuRef} className="relative">
      <summary
        className="list-none cursor-pointer flex items-center gap-2 px-2 py-1 rounded-md hover:bg-muted transition-colors"
        aria-label={`Tenant: ${currentName}`}
      >
        <Avatar name={currentName} size="sm" />
        <span className="text-sm font-medium max-w-32 truncate">
          {currentName}
        </span>
        <ChevronDown className="w-4 h-4 text-muted-foreground" />
      </summary>
      <div className="absolute right-0 top-full mt-1 w-64 bg-card border border-border rounded-md shadow-lg py-1 z-50">
        <p className="px-4 py-1 text-xs text-muted-foreground">Tenant</p>
        <button
          type="button"
          onClick={() => handleSelect(null)}
          aria-current={activeTenantId === null ? "true" : undefined}
          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left hover:bg-muted transition-colors"
        >
          <Avatar name={personalName} size="sm" />
          <span className="flex-1 truncate">{personalName}</span>
          <Badge variant="outline">Personal</Badge>
          {activeTenantId === null && <Check className="w-4 h-4 shrink-0" />}
        </button>
        {orgs.map((org) => (
          <button
            key={org.id}
            type="button"
            onClick={() => handleSelect(org.id)}
            aria-current={activeTenantId === org.id ? "true" : undefined}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left hover:bg-muted transition-colors"
          >
            <Avatar name={org.name} size="sm" />
            <span className="flex-1 truncate">{org.name}</span>
            <Badge variant="outline">{org.role}</Badge>
            {activeTenantId === org.id && (
              <Check className="w-4 h-4 shrink-0" />
            )}
          </button>
        ))}
        <div className="border-t border-border my-1" />
        <Link
          href="/account"
          onClick={closeMenu}
          className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-muted transition-colors"
        >
          <User className="w-4 h-4" />
          Account
        </Link>
        <button
          type="button"
          onClick={() => void signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left hover:bg-muted transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </details>
  );
}
