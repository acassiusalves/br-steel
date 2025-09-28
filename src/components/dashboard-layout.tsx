
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Settings,
  Code,
  ShoppingCart,
  Factory,
  Warehouse,
  ClipboardList,
  LogOut,
  Menu,
  ChevronDown,
  PackagePlus,
  Boxes,
  Users,
} from "lucide-react";
import * as React from "react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const Logo = () => (
    <svg width="120" height="30" viewBox="0 0 120 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <text x="0" y="22" fontFamily="Inter, sans-serif" fontSize="24" fontWeight="bold" fill="hsl(var(--foreground))">
        BR
        <tspan fill="hsl(var(--primary))">Steel</tspan>
      </text>
    </svg>
);

const navItems = [
    { 
        href: "/vendas", 
        icon: ShoppingCart, 
        label: "Vendas",
        subItems: [
            { href: "/vendas?tab=dashboard", icon: LayoutDashboard, label: "Dashboard" },
            { href: "/vendas?tab=listagem", icon: ShoppingCart, label: "Listagem" },
        ]
    },
    { href: "/producao", icon: Factory, label: "Produção" },
    { 
        href: "/insumos", 
        icon: ClipboardList, 
        label: "Insumos",
        subItems: [
            { href: "/insumos?tab=cadastro", icon: PackagePlus, label: "Cadastro" },
            { href: "/insumos?tab=estoque", icon: Boxes, label: "Estoque de Insumo" },
        ]
    },
    { href: "/estoque", icon: Warehouse, label: "Estoque" },
    { href: "/api", icon: Code, label: "API" },
    { 
        href: "/configuracoes", 
        icon: Settings, 
        label: "Configurações",
        subItems: [
            { href: "/configuracoes?tab=geral", icon: Settings, label: "Geral" },
            { href: "/configuracoes?tab=usuarios", icon: Users, label: "Usuários" },
        ]
    },
];

const NavLink = ({ item, pathname, searchParams }: { item: typeof navItems[0], pathname: string, searchParams: URLSearchParams }) => {
    const currentTab = searchParams.get('tab');
    const baseIsActive = pathname.startsWith(item.href);

    const isActive = item.subItems ? 
        baseIsActive : 
        pathname === item.href;

    if (item.subItems) {
        return (
             <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        className={cn(
                            "transition-colors text-sm font-medium hover:text-primary gap-1",
                            isActive ? "text-primary" : "text-muted-foreground"
                        )}
                    >
                        {item.label}
                        <ChevronDown className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                    {item.subItems.map(subItem => {
                        const subItemTab = subItem.href.split('tab=')[1];
                        const isSubItemActive = baseIsActive && (currentTab === subItemTab || (!currentTab && subItemTab === 'geral'));
                        return (
                            <Link key={subItem.href} href={subItem.href} passHref>
                                <DropdownMenuItem className={cn(isSubItemActive && "bg-accent")}>
                                    <subItem.icon className="mr-2 h-4 w-4" />
                                    {subItem.label}
                                </DropdownMenuItem>
                            </Link>
                        )
                    })}
                </DropdownMenuContent>
            </DropdownMenu>
        )
    }

    return (
        <Link
            href={item.href}
            className={cn(
                "transition-colors text-sm font-medium hover:text-primary",
                isActive ? "text-primary" : "text-muted-foreground"
            )}
        >
            {item.label}
        </Link>
    );
};


export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParamsString = usePathname().split('?')[1] || '';
  const searchParams = new URLSearchParams(searchParamsString);
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('isAuthenticated');
    toast({
        title: "Logout realizado com sucesso!",
        description: "Você será redirecionado para a tela de login.",
    });
    router.push('/login');
  };

  const MobileNavLink = ({ item }: { item: typeof navItems[0]}) => {
    const baseIsActive = pathname.startsWith(item.href);
    const [isSubMenuOpen, setIsSubMenuOpen] = React.useState(baseIsActive);

    if (item.subItems) {
      return (
        <div>
          <button
            onClick={() => setIsSubMenuOpen(!isSubMenuOpen)}
            className="flex w-full items-center justify-between gap-4 px-2.5 py-2 text-muted-foreground hover:text-foreground"
          >
            <div className="flex items-center gap-4">
              <item.icon className="h-5 w-5" />
              {item.label}
            </div>
            <ChevronDown className={cn("h-4 w-4 transition-transform", isSubMenuOpen && "rotate-180")} />
          </button>
          {isSubMenuOpen && (
            <div className="flex flex-col pl-8 pt-2">
              {item.subItems.map(sub => {
                  const currentTab = searchParams.get('tab');
                  const subItemTab = sub.href.split('tab=')[1];
                  const isSubItemActive = baseIsActive && (currentTab === subItemTab || (!currentTab && subItemTab === 'geral'));
                  return (
                    <Link
                      key={sub.href}
                      href={sub.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                          "flex items-center gap-4 px-2.5 py-2 text-muted-foreground hover:text-foreground text-sm",
                          isSubItemActive && "text-foreground bg-accent rounded-md"
                      )}
                    >
                      <sub.icon className="h-4 w-4" />
                      {sub.label}
                    </Link>
                  )
              })}
            </div>
          )}
        </div>
      );
    }
    
    return (
       <Link
          href={item.href}
          onClick={() => setOpen(false)}
          className={cn(
              "flex items-center gap-4 px-2.5 py-2 text-muted-foreground hover:text-foreground",
              pathname === item.href && "text-foreground bg-accent rounded-md"
          )}
          >
          <item.icon className="h-5 w-5" />
          {item.label}
      </Link>
    )
  }

  return (
     <div className="flex min-h-screen w-full flex-col bg-muted/40">
        <header className="sticky top-0 flex h-16 items-center gap-4 border-b bg-background px-4 md:px-6 z-50">
            <nav className="hidden flex-col gap-6 text-lg font-medium md:flex md:flex-row md:items-center md:gap-5 md:text-sm lg:gap-6">
                <Link
                href="/vendas?tab=dashboard"
                className="flex items-center gap-2 text-lg font-semibold md:text-base"
                >
                    <Logo />
                </Link>
                {navItems.map(item => <NavLink key={item.href} item={item} pathname={pathname} searchParams={searchParams} />)}
            </nav>
          
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0 md:hidden"
              >
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle navigation menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col">
              <nav className="grid gap-2 text-lg font-medium">
                <Link
                  href="/vendas?tab=dashboard"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 text-lg font-semibold mb-4"
                >
                  <Logo />
                </Link>
                 {navItems.map(item => <MobileNavLink key={item.href} item={item} />)}
              </nav>
            </SheetContent>
          </Sheet>

          <div className="flex w-full items-center gap-4 md:ml-auto md:gap-2 lg:gap-4">
            <div className="ml-auto flex-1 sm:flex-initial" />
             <DropdownMenu>
                <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" className="rounded-full">
                    <Avatar className="h-9 w-9">
                        <AvatarImage src="https://picsum.photos/100" alt="Avatar do usuário" data-ai-hint="profile picture" />
                        <AvatarFallback>JD</AvatarFallback>
                    </Avatar>
                    <span className="sr-only">Toggle user menu</span>
                </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                <DropdownMenuLabel>Minha Conta</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Configurações</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>Sair</DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex flex-1 flex-col">
            {children}
        </main>
    </div>
  );
}

    