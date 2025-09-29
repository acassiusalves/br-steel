
'use client';

import * as React from 'react';
import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { User } from '@/types/user';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

export default function PerfilPage() {
    const [user, setUser] = React.useState<User | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isSaving, setIsSaving] = React.useState(false);
    const [mustChangePassword, setMustChangePassword] = React.useState(false);
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
                        const userDoc = querySnapshot.docs[0];
                        const userData = userDoc.data() as User;
                        setUser({ id: userDoc.id, ...userData });
                        if (userData.mustChangePassword) {
                            setMustChangePassword(true);
                        }
                    } else {
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

    const handleProfileUpdate = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!user || !user.id || user.id === 'local') return;

        setIsSaving(true);
        const formData = new FormData(event.currentTarget);
        const newName = formData.get('name') as string;
        const newPassword = formData.get('new-password') as string;
        const confirmPassword = formData.get('confirm-password') as string;

        if (newPassword && newPassword !== confirmPassword) {
            toast({ variant: 'destructive', title: 'Erro', description: 'As novas senhas não coincidem.' });
            setIsSaving(false);
            return;
        }

        try {
            const userDocRef = doc(db, 'users', user.id);
            const dataToUpdate: any = {
                name: newName
            };

            if (mustChangePassword && newPassword) {
                // In a real app, you would call Firebase Auth to update the password.
                // Here, we just update the flag in Firestore.
                dataToUpdate.mustChangePassword = false;
            }
            
            await updateDoc(userDocRef, dataToUpdate);

            setUser(prev => prev ? { ...prev, name: newName, mustChangePassword: false } : null);
            if (mustChangePassword) setMustChangePassword(false);


            toast({
                title: "Perfil Atualizado!",
                description: "Suas informações foram salvas com sucesso."
            });
        } catch (error) {
             toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível salvar as alterações.' });
        } finally {
            setIsSaving(false);
        }
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

                {mustChangePassword && (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Ação Necessária</AlertTitle>
                        <AlertDescription>
                            Este é seu primeiro acesso. Por favor, cadastre uma nova senha para continuar.
                        </AlertDescription>
                    </Alert>
                )}
                 <form onSubmit={handleProfileUpdate}>
                    <Card>
                        <CardHeader>
                            <CardTitle>Informações Pessoais</CardTitle>
                            <CardDescription>
                                Seu e-mail e função não podem ser alterados nesta tela.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="name">Nome</Label>
                                    <Input id="name" name="name" defaultValue={user?.name} required />
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
                    </Card>

                    <Card className="mt-8">
                        <CardHeader>
                            <CardTitle>Alterar Senha</CardTitle>
                            <CardDescription>
                               Para sua segurança, recomendamos o uso de uma senha forte.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                             {!mustChangePassword && (
                                <div className="space-y-2">
                                    <Label htmlFor="current-password">Senha Atual</Label>
                                    <Input id="current-password" type="password" />
                                </div>
                             )}
                             <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="new-password">Nova Senha</Label>
                                    <Input id="new-password" name="new-password" type="password" required={mustChangePassword} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="confirm-password">Confirmar Nova Senha</Label>
                                    <Input id="confirm-password" name="confirm-password" type="password" required={mustChangePassword} />
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
            </div>
        </DashboardLayout>
    );
}
