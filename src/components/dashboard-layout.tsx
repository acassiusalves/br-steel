
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
    { href: "/dashboard", icon: LayoutDashboard, label: "Painel de Vendas" },
    { href: "/vendas", icon: ShoppingCart, label: "Vendas" },
    { href: "/producao", icon: Factory, label: "Produção" },
    { href: "/insumos", icon: ClipboardList, label: "Insumos" },
    { href: "/estoque", icon: Warehouse, label: "Estoque" },
    { href: "/api", icon: Code, label: "API" },
];

const NavLink = ({ href, label, isActive }: { href: string, label: string, isActive: boolean }) => (
     <Link
        href={href}
        className={cn(
            "transition-colors text-sm font-medium hover:text-primary",
            isActive ? "text-primary" : "text-muted-foreground"
        )}
        >
        {label}
    </Link>
);


export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
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

  const MobileNavLink = ({ href, icon: Icon, label }: typeof navItems[0]) => (
     <Link
        href={href}
        onClick={() => setOpen(false)}
        className={cn(
            "flex items-center gap-4 px-2.5 py-2 text-muted-foreground hover:text-foreground",
            pathname === href && "text-foreground bg-accent rounded-md"
        )}
        >
        <Icon className="h-5 w-5" />
        {label}
    </Link>
  )

  return (
     <div className="flex min-h-screen w-full flex-col bg-muted/40">
        <header className="sticky top-0 flex h-16 items-center gap-4 border-b bg-background px-4 md:px-6 z-50">
            <nav className="hidden flex-col gap-6 text-lg font-medium md:flex md:flex-row md:items-center md:gap-5 md:text-sm lg:gap-6">
                <Link
                href="/dashboard"
                className="flex items-center gap-2 text-lg font-semibold md:text-base"
                >
                    <Logo />
                </Link>
                {navItems.map(item => <NavLink key={item.href} href={item.href} label={item.label} isActive={pathname === item.href} />)}
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
                  href="/dashboard"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 text-lg font-semibold mb-4"
                >
                  <Logo />
                </Link>
                 {navItems.map(item => <MobileNavLink key={item.href} {...item} />)}
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
