
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
import {
  Sidebar,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarInset,
  SidebarProvider,
  SidebarFooter,
  SidebarTrigger,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { useToast } from "@/hooks/use-toast";

const Logo = () => (
    <svg width="120" height="30" viewBox="0 0 120 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <text x="0" y="22" fontFamily="Inter, sans-serif" fontSize="24" fontWeight="bold" fill="#534B4B">
        BR
        <tspan fill="#E33324">Steel</tspan>
      </text>
    </svg>
);


export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();

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

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
            <Link href="/dashboard" className="flex items-center gap-2">
                <Logo />
            </Link>
        </SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <Button asChild variant="ghost" className="w-full justify-start">
              <Link href="/dashboard">
                  <LayoutDashboard />
                  <span>Painel de Vendas</span>
              </Link>
            </Button>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <Button asChild variant="ghost" className="w-full justify-start">
              <Link href="/vendas">
                  <ShoppingCart />
                  <span>Vendas</span>
              </Link>
            </Button>
          </SidebarMenuItem>
           <SidebarMenuItem>
            <Button asChild variant="ghost" className="w-full justify-start">
              <Link href="/producao">
                  <Factory />
                  <span>Produção</span>
              </Link>
            </Button>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <Button asChild variant="ghost" className="w-full justify-start">
              <Link href="/insumos">
                  <ClipboardList />
                  <span>Insumos</span>
              </Link>
            </Button>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <Button asChild variant="ghost" className="w-full justify-start">
              <Link href="/estoque">
                  <Warehouse />
                  <span>Estoque</span>
              </Link>
            </Button>
          </SidebarMenuItem>
          <SidebarMenuItem>
             <Button asChild variant="ghost" className="w-full justify-start">
              <Link href="/api">
                <Code />
                <span>API</span>
              </Link>
            </Button>
          </SidebarMenuItem>
        </SidebarMenu>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 items-center justify-between border-b bg-background px-4 sticky top-0 z-20 md:justify-end">
            <SidebarTrigger className="md:hidden" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-9 w-9 rounded-full">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src="https://picsum.photos/100" alt="Avatar do usuário" data-ai-hint="profile picture" />
                    <AvatarFallback>JD</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">João da Silva</p>
                    <p className="text-xs leading-none text-muted-foreground">
                      joao.silva@email.com
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem>Perfil</DropdownMenuItem>
                  <DropdownMenuItem>Configurações</DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
        </header>
        <main>{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
