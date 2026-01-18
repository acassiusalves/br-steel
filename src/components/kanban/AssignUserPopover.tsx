'use client';

import * as React from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Check, Loader2, User, UserMinus, UserPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { User as UserType } from '@/types/user';
import type { AssignedUser } from '@/types/kanban';

interface AssignUserPopoverProps {
  currentUser: AssignedUser | null;
  onAssign: (user: AssignedUser | null) => void;
}

export function AssignUserPopover({ currentUser, onAssign }: AssignUserPopoverProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [users, setUsers] = React.useState<UserType[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);

  // Carrega usuários quando o popover abre
  React.useEffect(() => {
    if (isOpen && users.length === 0) {
      loadUsers();
    }
  }, [isOpen]);

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const q = query(usersRef, orderBy('name', 'asc'));
      const snapshot = await getDocs(q);

      const usersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as UserType[];

      // Filtra apenas usuários que podem ser atribuídos (Operador e Administrador)
      const assignableUsers = usersData.filter(
        u => u.role === 'Operador' || u.role === 'Administrador'
      );

      setUsers(assignableUsers);
    } catch (error) {
      console.error('Erro ao carregar usuários:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelect = (user: UserType) => {
    onAssign({
      userId: user.id,
      userName: user.name,
      assignedAt: new Date().toISOString(),
    });
    setIsOpen(false);
  };

  const handleRemove = () => {
    onAssign(null);
    setIsOpen(false);
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start">
          {currentUser ? (
            <div className="flex items-center gap-2">
              <Avatar className="h-5 w-5">
                <AvatarFallback className="text-[10px]">
                  {getInitials(currentUser.userName)}
                </AvatarFallback>
              </Avatar>
              <span>{currentUser.userName}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground">
              <User className="h-4 w-4" />
              <span>Selecionar responsável</span>
            </div>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[250px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar usuário..." />
          <CommandList>
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <CommandEmpty>Nenhum usuário encontrado.</CommandEmpty>
                <CommandGroup>
                  {/* Opção para remover responsável */}
                  {currentUser && (
                    <CommandItem
                      onSelect={handleRemove}
                      className="text-muted-foreground"
                    >
                      <UserMinus className="mr-2 h-4 w-4" />
                      Remover responsável
                    </CommandItem>
                  )}

                  {/* Lista de usuários */}
                  {users.map(user => (
                    <CommandItem
                      key={user.id}
                      onSelect={() => handleSelect(user)}
                      className="flex items-center gap-2"
                    >
                      <Avatar className="h-6 w-6">
                        <AvatarFallback className="text-[10px]">
                          {getInitials(user.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <p className="text-sm">{user.name}</p>
                        <p className="text-xs text-muted-foreground">{user.role}</p>
                      </div>
                      {currentUser?.userId === user.id && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
