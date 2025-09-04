
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
  DropdownMenuGroup
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const Logo = () => (
    <svg width="120" height="30" viewBox="0 0 120 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <text x="0" y="22" fontFamily="Inter, sans-serif" fontSize="24" fontWeight="bold" fill="#534B4B">
        BR
        <tspan fill="#E33324">Steel</tspan>
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

  const NavLink = ({ href, icon: Icon, label }: typeof navItems[0]) => (
     <Link
        href={href}
        onClick={() => setOpen(false)}
        className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary",
            pathname === href && "text-primary bg-muted"
        )}
        >
        <Icon className="h-4 w-4" />
        {label}
    </Link>
  )

  return (
     <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
      <div className="hidden border-r bg-muted/40 md:block">
        <div className="flex h-full max-h-screen flex-col gap-2">
          <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <Logo />
            </Link>
          </div>
          <div className="flex-1">
            <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
              {navItems.map(item => <NavLink key={item.href} {...item} />)}
            </nav>
          </div>
        </div>
      </div>
      <div className="flex flex-col">
        <header className="flex h-14 items-center gap-4 border-b bg-muted/40 px-4 lg:h-[60px] lg:px-6">
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
                  href="#"
                  className="flex items-center gap-2 text-lg font-semibold mb-4"
                >
                  <Logo />
                </Link>
                 {navItems.map(item => <NavLink key={item.href} {...item} />)}
              </nav>
            </SheetContent>
          </Sheet>
          <div className="w-full flex-1" />
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
               <DropdownMenuItem>Perfil</DropdownMenuItem>
               <DropdownMenuItem>Configurações</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>Sair</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex flex-1 flex-col gap-4 bg-muted/40">
            {children}
        </main>
      </div>
    </div>
  );
}
