
'use client';

import * as React from 'react';
import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { User } from '@/types/user';

export default function PerfilPage() {
    const [user, setUser] = React.useState<User | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isSaving, setIsSaving] = React.useState(false);
    const { toast } = useToast();

    React.useEffect(() => {
        const fetchUserData = async () => {
            setIsLoading(true);
            const userEmail = localStorage.getItem('userEmail');
            if (userEmail) {
                try {
                    const q = query(collection(db, "users"), where("email", "==", userEmail));
                    const querySnapshot = await getDocs(q);
                    if (!querySnapshot.empty) {
                        const userData = querySnapshot.docs[0].data() as User;
                        setUser({ id: querySnapshot.docs[0].id, ...userData });
                    } else {
                         // Fallback for user not in DB (e.g. initial login)
                        setUser({ id: 'local', name: 'Usuário Local', email: userEmail, role: 'Desconhecido' });
                    }
                } catch (error) {
                    console.error("Erro ao buscar usuário:", error);
                    toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível carregar os dados do usuário.' });
                }
            }
            setIsLoading(false);
        };
        fetchUserData();
    }, [toast]);

    const handleSaveChanges = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setIsSaving(true);
        toast({
            title: "Simulação",
            description: "A funcionalidade de salvar ainda não foi implementada."
        });
        setTimeout(() => setIsSaving(false), 1000);
    };
    
    if (isLoading) {
        return (
             <DashboardLayout>
                <div className="flex-1 space-y-8 p-4 pt-6 md:p-8 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin" />
                </div>
            </DashboardLayout>
        )
    }

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
                                Atualize seus dados. O e-mail e a função não podem ser alterados.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="name">Nome</Label>
                                    <Input id="name" defaultValue={user?.name} required />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="email">E-mail</Label>
                                    <Input id="email" type="email" defaultValue={user?.email} disabled />
                                </div>
                                 <div className="space-y-2">
                                    <Label htmlFor="role">Função</Label>
                                    <Input id="role" defaultValue={user?.role} disabled />
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
