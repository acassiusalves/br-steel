"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  ChevronRight,
  ClipboardList,
  DollarSign,
  Factory,
  Kanban,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MessageCircle,
  Package,
  PackagePlus,
  Plug,
  RefreshCw,
  Search,
  Settings,
  ShoppingCart,
  Store,
  User,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";

import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

type NavSubItem = {
  href: string;
  icon: LucideIcon;
  label: string;
};

type NavItem = NavSubItem & {
  subItems?: NavSubItem[];
};

const defaultTabsByPath: Record<string, string> = {
  "/vendas": "dashboard",
  "/insumos": "cadastro",
};

const allNavItems: NavItem[] = [
  {
    href: "/vendas",
    icon: ShoppingCart,
    label: "Vendas",
    subItems: [
      { href: "/vendas?tab=dashboard", icon: LayoutDashboard, label: "Dashboard" },
      { href: "/vendas?tab=listagem", icon: ShoppingCart, label: "Listagem" },
      { href: "/vendas?tab=curva-abc", icon: BarChart3, label: "Curva ABC" },
      { href: "/vendas?tab=recorrencia", icon: RefreshCw, label: "Recorrência" },
    ],
  },
  {
    href: "/producao",
    icon: Factory,
    label: "Produção",
    subItems: [
      { href: "/producao", icon: BarChart3, label: "Análise" },
      { href: "/producao/kanban", icon: Kanban, label: "Kanban" },
    ],
  },
  {
    href: "/insumos",
    icon: ClipboardList,
    label: "Insumos",
    subItems: [
      { href: "/insumos?tab=cadastro", icon: PackagePlus, label: "Cadastro" },
      { href: "/insumos?tab=estoque", icon: Boxes, label: "Estoque de Insumo" },
    ],
  },
  {
    href: "/financeiro/conciliacao",
    icon: DollarSign,
    label: "Financeiro",
    subItems: [
      { href: "/financeiro/conciliacao", icon: ClipboardList, label: "Conciliação" },
    ],
  },
  { href: "/produtos", icon: Package, label: "Produtos" },
  { href: "/estoque", icon: Warehouse, label: "Estoque" },
  {
    href: "/anuncios-mercado-livre",
    icon: Store,
    label: "Marketplace",
    subItems: [
      { href: "/anuncios-mercado-livre", icon: Store, label: "Anúncios ML" },
      { href: "/analise-ads", icon: BarChart3, label: "Análise Ads" },
      { href: "/buscar-mercado-livre", icon: Search, label: "Buscar ML" },
      { href: "/atendimento/chat", icon: MessageCircle, label: "Atendimento" },
    ],
  },
  {
    href: "/configuracoes",
    icon: Settings,
    label: "Configurações",
    subItems: [
      { href: "/configuracoes", icon: Users, label: "Usuários e Permissões" },
      { href: "/api-settings", icon: Plug, label: "Conexão API" },
      { href: "/ml-docs", icon: BookOpen, label: "Docs Mercado Livre" },
    ],
  },
];

const splitHref = (href: string) => {
  const [path, queryString] = href.split("?");
  const tab = queryString ? new URLSearchParams(queryString).get("tab") : null;

  return { path, tab };
};

const isHrefActive = (href: string, pathname: string, currentTab: string | null) => {
  const { path, tab } = splitHref(href);

  if (pathname !== path) return false;
  if (!tab) return true;

  return (currentTab ?? defaultTabsByPath[path] ?? null) === tab;
};

const isNavItemActive = (item: NavItem, pathname: string, currentTab: string | null) => {
  if (item.subItems?.length) {
    return item.subItems.some((subItem) => isHrefActive(subItem.href, pathname, currentTab));
  }

  return isHrefActive(item.href, pathname, currentTab);
};

const Logo = ({ collapsed }: { collapsed: boolean }) => {
  if (collapsed) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-sm">
        BR
      </div>
    );
  }

  return (
    <svg width="120" height="30" viewBox="0 0 120 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <text x="0" y="22" fontFamily="Inter, sans-serif" fontSize="24" fontWeight="bold" fill="hsl(var(--foreground))">
        BR
        <tspan fill="hsl(var(--primary))">Steel</tspan>
      </text>
    </svg>
  );
};

const SidebarItem = ({
  icon: Icon,
  label,
  href,
  active,
  collapsed,
  onClick,
  compact = false,
}: {
  icon: LucideIcon;
  label: string;
  href: string;
  active: boolean;
  collapsed: boolean;
  onClick?: () => void;
  compact?: boolean;
}) => (
  <Link
    href={href}
    onClick={onClick}
    title={collapsed ? label : undefined}
    aria-current={active ? "page" : undefined}
    className={cn(
      "flex items-center transition-all duration-200",
      collapsed
        ? "min-h-11 justify-center rounded-xl px-0 py-3"
        : compact
          ? "gap-2 rounded-lg px-2 py-2"
          : "gap-3 rounded-xl px-3 py-3",
      active
        ? "bg-gray-100 font-medium text-[#262626]"
        : "text-[#8E8E8E] hover:bg-gray-50 hover:text-[#262626]"
    )}
  >
    <Icon className={cn("flex-shrink-0", compact ? "h-4 w-4" : "h-5 w-5")} />
    <span
      className={cn(
        "transition-all duration-300",
        compact ? "whitespace-normal text-[13px] leading-tight" : "whitespace-nowrap text-sm",
        collapsed ? "w-0 overflow-hidden opacity-0" : "w-auto opacity-100"
      )}
    >
      {label}
    </span>
  </Link>
);

const SidebarGroup = ({
  icon: Icon,
  label,
  children,
  isOpen,
  onToggle,
  anyChildActive,
  collapsed,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  anyChildActive: boolean;
  collapsed: boolean;
}) => (
  <div className="flex flex-col">
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      title={collapsed ? label : undefined}
      className={cn(
        "flex w-full items-center rounded-xl transition-all duration-200",
        collapsed ? "min-h-11 justify-center px-0 py-3" : "justify-between gap-3 px-3 py-3",
        anyChildActive
          ? "bg-gray-100 font-medium text-[#262626]"
          : "text-[#8E8E8E] hover:bg-gray-50 hover:text-[#262626]"
      )}
    >
      <div className={cn("flex items-center", collapsed ? "justify-center" : "gap-3")}>
        <Icon className="h-5 w-5 flex-shrink-0" />
        <span
          className={cn(
            "whitespace-nowrap text-sm transition-all duration-300",
            collapsed ? "w-0 overflow-hidden opacity-0" : "w-auto opacity-100"
          )}
        >
          {label}
        </span>
      </div>
      <ChevronRight
        className={cn(
          "h-4 w-4 flex-shrink-0 transition-all duration-300",
          collapsed ? "w-0 overflow-hidden opacity-0" : "w-auto opacity-100",
          isOpen && "rotate-90"
        )}
      />
    </button>
    {!collapsed && isOpen && <div className="ml-8 mt-1 flex flex-col gap-1 transition-all duration-200">{children}</div>}
  </div>
);

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab");
  const router = useRouter();
  const { toast } = useToast();
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(true);
  const [activeMenu, setActiveMenu] = React.useState<string | null>(null);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = React.useState(false);
  const accountMenuRef = React.useRef<HTMLDivElement>(null);

  const { user, permissions, inactivePages, isAuthenticated, isLoading, logout } = useAuth();

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  const navItems = React.useMemo<NavItem[]>(() => {
    if (!user) return [];

    const userRole = user.role;
    const hasAccessToPath = (path: string) => {
      const pageIsActive = !inactivePages.includes(path);
      const userHasPermission = permissions[path]?.includes(userRole) || userRole === "Administrador";

      return pageIsActive && userHasPermission;
    };

    return allNavItems
      .map((item) => {
        if (item.subItems) {
          const allowedSubItems = item.subItems.filter((subItem) => {
            const { path } = splitHref(subItem.href);

            return hasAccessToPath(path);
          });

          if (allowedSubItems.length > 0) {
            return { ...item, subItems: allowedSubItems };
          }

          return null;
        }

        return hasAccessToPath(item.href) ? item : null;
      })
      .filter((item): item is NavItem => item !== null);
  }, [user, permissions, inactivePages]);

  React.useEffect(() => {
    const activeGroup = navItems.find((item) => item.subItems?.some((subItem) => isHrefActive(subItem.href, pathname, currentTab)))?.href;

    setActiveMenu(activeGroup ?? null);
  }, [currentTab, navItems, pathname]);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (accountMenuRef.current && event.target instanceof Node && !accountMenuRef.current.contains(event.target)) {
        setIsAccountMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  React.useEffect(() => {
    setIsSidebarOpen(false);
    setIsAccountMenuOpen(false);
  }, [pathname, currentTab]);

  const isDesktopViewport = () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;

  const handleSidebarMouseEnter = () => {
    if (!isDesktopViewport()) return;
    setIsSidebarCollapsed(false);
  };

  const handleSidebarMouseLeave = () => {
    if (!isDesktopViewport()) return;
    setIsSidebarCollapsed(true);
  };

  const handleCloseSidebarOnMobile = () => {
    setIsSidebarOpen(false);
  };

  const handleToggleGroup = (href: string) => {
    if (isDesktopViewport() && isSidebarCollapsed) {
      setIsSidebarCollapsed(false);
    }

    setActiveMenu((prev) => (prev === href ? null : href));
  };

  const handleLogout = () => {
    setIsAccountMenuOpen(false);
    logout();
    toast({
      title: "Logout realizado com sucesso!",
      description: "Você será redirecionado para a tela de login.",
    });
    router.push("/login");
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const isSidebarVisuallyCollapsed = !isSidebarOpen && isSidebarCollapsed;
  const homeHref = navItems[0]?.subItems?.[0]?.href ?? navItems[0]?.href ?? "/perfil";
  const displayName = user?.name || user?.email?.split("@")[0] || "Usuário";
  const userInitial = displayName.trim().charAt(0).toUpperCase() || "U";

  return (
    <div className="flex min-h-screen bg-[#FAFAFA] font-sans text-[hsl(var(--foreground))]">
      {isSidebarOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside
        onMouseEnter={handleSidebarMouseEnter}
        onMouseLeave={handleSidebarMouseLeave}
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 overflow-hidden border-r border-gray-200 bg-white/95 shadow-sm backdrop-blur-md transition-all duration-300 ease-in-out md:w-16",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          !isSidebarCollapsed && "md:w-64"
        )}
      >
        <div className="flex h-full flex-col px-3 py-6">
          <Link
            href={homeHref}
            onClick={handleCloseSidebarOnMobile}
            className={cn(
              "mb-2 flex items-center rounded-xl transition-colors hover:bg-gray-50",
              isSidebarVisuallyCollapsed ? "justify-center px-0 py-2" : "gap-3 px-2 py-3"
            )}
          >
            <Logo collapsed={isSidebarVisuallyCollapsed} />
          </Link>

          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto pr-1">
            {navItems.map((item) => {
              const active = isNavItemActive(item, pathname, currentTab);

              if (item.subItems?.length) {
                return (
                  <SidebarGroup
                    key={item.href}
                    icon={item.icon}
                    label={item.label}
                    isOpen={activeMenu === item.href}
                    onToggle={() => handleToggleGroup(item.href)}
                    anyChildActive={active}
                    collapsed={isSidebarVisuallyCollapsed}
                  >
                    {item.subItems.map((subItem) => (
                      <SidebarItem
                        key={subItem.href}
                        icon={subItem.icon}
                        label={subItem.label}
                        href={subItem.href}
                        active={isHrefActive(subItem.href, pathname, currentTab)}
                        collapsed={false}
                        onClick={handleCloseSidebarOnMobile}
                      />
                    ))}
                  </SidebarGroup>
                );
              }

              return (
                <SidebarItem
                  key={item.href}
                  icon={item.icon}
                  label={item.label}
                  href={item.href}
                  active={active}
                  collapsed={isSidebarVisuallyCollapsed}
                  onClick={handleCloseSidebarOnMobile}
                />
              );
            })}
          </nav>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col md:ml-16">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4 md:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => setIsSidebarOpen((prev) => !prev)}
            className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 md:hidden"
            aria-label="Abrir menu"
          >
            <Menu size={20} />
          </button>

          <div className="ml-auto flex items-center gap-3">
            <p className="hidden text-xs font-semibold text-zinc-900 sm:block">{displayName}</p>
            <button
              type="button"
              className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
              title="Notificações"
              aria-label="Notificações"
            >
              <Bell size={18} />
            </button>
            <div className="relative" ref={accountMenuRef}>
              <button
                type="button"
                onClick={() => setIsAccountMenuOpen((prev) => !prev)}
                className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-gradient-to-br from-primary to-red-500 text-sm font-bold text-white shadow-lg"
                aria-label="Abrir menu da conta"
                aria-expanded={isAccountMenuOpen}
              >
                {userInitial}
              </button>

              {isAccountMenuOpen && (
                <div className="absolute right-0 top-12 z-50 w-56 rounded-xl border border-zinc-200 bg-white py-2 shadow-xl">
                  <div className="border-b border-zinc-100 px-4 py-3">
                    <p className="truncate text-sm font-semibold text-zinc-900">{displayName}</p>
                    <p className="truncate text-xs text-zinc-500">{user?.email}</p>
                  </div>

                  <div className="py-1">
                    <Link
                      href="/perfil"
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-50"
                    >
                      <User size={16} className="text-zinc-400" />
                      Meu Perfil
                    </Link>
                  </div>

                  <div className="border-t border-zinc-100 pt-1">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-red-500 transition-colors hover:bg-red-50"
                    >
                      <LogOut size={16} />
                      Sair
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="min-w-0 flex-1">{children}</div>
      </main>
    </div>
  );
}
