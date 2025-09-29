
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

const Logo = () => (
    <svg width="120" height="30" viewBox="0 0 120 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <text x="0" y="22" fontFamily="Inter, sans-serif" fontSize="24" fontWeight="bold" fill="#534B4B">
        BR
        <tspan fill="#E33324">Steel</tspan>
      </text>
    </svg>
);


export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = React.useState(false);

  const handleLogin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);

    const formData = new FormData(event.currentTarget);
    const email = formData.get('email') as string;

    // Simulate API call
    setTimeout(() => {
      // For this prototype, we'll simulate a successful login every time.
      // In a real app, you'd handle authentication here.
      if (typeof window !== "undefined") {
          localStorage.setItem('isAuthenticated', 'true');
          localStorage.setItem('userEmail', email); // Save user email
      }
      
      toast({
        title: "Login bem-sucedido!",
        description: "Redirecionando para o painel...",
      });

      router.push('/vendas?tab=dashboard');
      setIsLoading(false);
    }, 1000);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
       <Card className="w-full max-w-sm">
        <form onSubmit={handleLogin}>
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
                <Logo />
            </div>
            <CardTitle className="text-2xl">Login</CardTitle>
            <CardDescription>
              Digite seu e-mail e senha para acessar o painel.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input 
                id="email" 
                name="email"
                type="email" 
                placeholder="seu@email.com" 
                required 
                defaultValue="acassiusalves@gmail.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input 
                id="password" 
                type="password" 
                required 
                defaultValue="password"
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button className="w-full" type="submit" disabled={isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {isLoading ? 'Entrando...' : 'Entrar'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
