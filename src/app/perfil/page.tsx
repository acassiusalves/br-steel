'use client';

import * as React from 'react';
import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, KeyRound, User } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';

export default function PerfilPage() {
    const [isSaving, setIsSaving] = React.useState(false);
    const { toast } = useToast();

    // Placeholder data
    const user = {
        name: 'Admin',
        email: 'admin@brsteel.com',
        avatarUrl: 'https://picsum.photos/seed/user/100/100'
    };

    const handleSaveChanges = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setIsSaving(true);
        toast({
            title: "Simulação",
            description: "A funcionalidade de salvar ainda não foi implementada."
        });
        setTimeout(() => setIsSaving(false), 1000);
    };

    return (
        <DashboardLayout>
            <div className="flex-1 space-y-8 p-4 pt-6 md:p-8">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Meu Perfil</h2>
                    <p className="text-muted-foreground">
                        Gerencie suas informações pessoais e configurações de conta.
                    </p>
                </div>

                <form onSubmit={handleSaveChanges}>
                    <Card>
                        <CardHeader>
                            <CardTitle>Informações Pessoais</CardTitle>
                            <CardDescription>
                                Atualize seus dados. O e-mail não pode ser alterado.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                             <div className="flex items-center gap-4">
                                <Avatar className="h-16 w-16">
                                    <AvatarImage src={user.avatarUrl} alt="Avatar do usuário" data-ai-hint="profile picture" />
                                    <AvatarFallback>AD</AvatarFallback>
                                </Avatar>
                                <Button type="button" variant="outline">Alterar Foto</Button>
                            </div>
                            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="name">Nome</Label>
                                    <Input id="name" defaultValue={user.name} required />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="email">E-mail</Label>
                                    <Input id="email" type="email" defaultValue={user.email} disabled />
                                </div>
                            </div>
                        </CardContent>
                        <CardFooter className="border-t px-6 py-4">
                            <Button type="submit" disabled={isSaving}>
                                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Salvar Alterações
                            </Button>
                        </CardFooter>
                    </Card>
                </form>

                 <Card>
                    <CardHeader>
                        <CardTitle>Alterar Senha</CardTitle>
                        <CardDescription>
                           Para sua segurança, recomendamos o uso de uma senha forte.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="current-password">Senha Atual</Label>
                            <Input id="current-password" type="password" />
                        </div>
                         <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="new-password">Nova Senha</Label>
                                <Input id="new-password" type="password" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="confirm-password">Confirmar Nova Senha</Label>
                                <Input id="confirm-password" type="password" />
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter className="border-t px-6 py-4">
                        <Button type="button" disabled={isSaving}>
                            Alterar Senha
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        </DashboardLayout>
    );
}
