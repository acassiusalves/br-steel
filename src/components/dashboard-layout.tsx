"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  BrainCircuit,
  FileText,
  LayoutDashboard,
  Settings,
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarInset,
  SidebarProvider,
  SidebarFooter,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const Logo = () => (
    <svg width="120" height="30" viewBox="0 0 120 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <text x="0" y="22" fontFamily="Inter, sans-serif" fontSize="24" fontWeight="bold" fill="#534B4B">
        Market
        <tspan fill="#E33324">Flow</tspan>
      </text>
    </svg>
);


export default function DashboardLayout({ children }: { children: ReactNode }) {
  const [activeMenu, setActiveMenu] = React.useState("painel");

  const handleMenuClick = (menu: string) => {
    setActiveMenu(menu);
    const element = document.getElementById(menu);
    if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
    }
  }

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
            <Link href="/" className="flex items-center gap-2">
                <Logo />
            </Link>
        </SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => handleMenuClick('painel')}
              isActive={activeMenu === 'painel'}
              tooltip="Painel de Vendas"
            >
              <LayoutDashboard />
              <span>Painel de Vendas</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => handleMenuClick('analise')} isActive={activeMenu === 'analise'} tooltip="Análise Preditiva">
              <BrainCircuit />
              <span>Análise Preditiva</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => handleMenuClick('relatorios')} isActive={activeMenu === 'relatorios'} tooltip="Relatórios">
              <FileText />
              <span>Relatórios</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarFooter>
           <SidebarMenu>
             <SidebarMenuItem>
                <SidebarMenuButton tooltip="Configurações">
                    <Settings />
                    <span>Configurações</span>
                </SidebarMenuButton>
            </SidebarMenuItem>
           </SidebarMenu>
        </SidebarFooter>
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
                <DropdownMenuItem>Sair</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
        </header>
        <main>{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
