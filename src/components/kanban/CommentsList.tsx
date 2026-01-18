'use client';

import * as React from 'react';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Loader2, MessageSquare, MoreVertical, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card, CardContent } from '@/components/ui/card';
import {
  createComment,
  updateComment,
  deleteComment,
} from '@/services/kanban-service';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { ProductionComment } from '@/types/kanban';

interface CommentsListProps {
  lotId: string;
}

export function CommentsList({ lotId }: CommentsListProps) {
  const [comments, setComments] = React.useState<ProductionComment[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [newComment, setNewComment] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editContent, setEditContent] = React.useState('');

  const { user } = useAuth();
  const { toast } = useToast();

  // Listener real-time para comentários
  React.useEffect(() => {
    const commentsRef = collection(db, 'productionComments');
    const q = query(
      commentsRef,
      where('lotId', '==', lotId),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const commentsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as ProductionComment[];
        setComments(commentsData);
        setIsLoading(false);
      },
      (error) => {
        console.error('Erro ao carregar comentários:', error);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [lotId]);

  const handleSubmit = async () => {
    if (!newComment.trim()) return;

    setIsSubmitting(true);
    try {
      await createComment({
        lotId,
        content: newComment.trim(),
        author: {
          userId: user?.id || '',
          userName: user?.name || 'Usuário',
        },
      });

      setNewComment('');
      toast({ title: 'Comentário adicionado' });
    } catch (error) {
      console.error('Erro ao criar comentário:', error);
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'Não foi possível adicionar o comentário.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = async (id: string) => {
    if (!editContent.trim()) return;

    try {
      await updateComment(id, editContent.trim());
      setEditingId(null);
      setEditContent('');
      toast({ title: 'Comentário atualizado' });
    } catch (error) {
      console.error('Erro ao atualizar comentário:', error);
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'Não foi possível atualizar o comentário.',
      });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteComment(id);
      toast({ title: 'Comentário excluído' });
    } catch (error) {
      console.error('Erro ao excluir comentário:', error);
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'Não foi possível excluir o comentário.',
      });
    }
  };

  const startEditing = (comment: ProductionComment) => {
    setEditingId(comment.id);
    setEditContent(comment.content);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditContent('');
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Card className="border-none shadow-none">
      <CardContent className="pt-4 space-y-4">
        {/* Input de novo comentário */}
        <div className="flex gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs">
              {user?.name ? getInitials(user.name) : 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-2">
            <Textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escreva um comentário..."
              rows={2}
              className="resize-none"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={!newComment.trim() || isSubmitting}
              >
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Comentar
              </Button>
            </div>
          </div>
        </div>

        {/* Lista de comentários */}
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <MessageSquare className="h-8 w-8 mb-2" />
            <p>Nenhum comentário ainda</p>
            <p className="text-xs">Seja o primeiro a comentar!</p>
          </div>
        ) : (
          <div className="space-y-4">
            {comments.map(comment => (
              <div key={comment.id} className="flex gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs">
                    {getInitials(comment.author.userName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">
                        {comment.author.userName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(comment.createdAt), {
                          addSuffix: true,
                          locale: ptBR,
                        })}
                      </span>
                      {comment.updatedAt && (
                        <span className="text-xs text-muted-foreground">(editado)</span>
                      )}
                    </div>

                    {comment.author.userId === user?.id && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => startEditing(comment)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleDelete(comment.id)}
                            className="text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>

                  {editingId === comment.id ? (
                    <div className="mt-2 space-y-2">
                      <Textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={2}
                        className="resize-none"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleEdit(comment.id)}>
                          Salvar
                        </Button>
                        <Button size="sm" variant="outline" onClick={cancelEditing}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm mt-1 whitespace-pre-wrap">
                      {comment.content}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
