
"use client";

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { SaleOrder } from '@/types/sale-order';

interface SaleOrderDetailModalProps {
  order: SaleOrder | null;
  isOpen: boolean;
  onClose: () => void;
}

const formatCurrency = (value: number | undefined) => {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    }).format(value || 0);
}

const formatDate = (dateString: string | undefined) => {
    if (!dateString || dateString.startsWith('0000')) return 'N/A';
    try {
        const date = new Date(dateString + 'T00:00:00');
        return new Intl.DateTimeFormat('pt-BR').format(date);
    } catch {
        return dateString;
    }
}

const DetailItem = ({ label, value }: { label: string, value: React.ReactNode }) => (
    <div className="flex flex-col">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <p className="text-sm text-gray-900">{value || 'N/A'}</p>
    </div>
);

export default function SaleOrderDetailModal({ order, isOpen, onClose }: SaleOrderDetailModalProps) {
  if (!order) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Detalhes do Pedido: #{order.numero} (ID: {order.id})</DialogTitle>
          <DialogDescription>
            Exibindo todas as informações detalhadas para o pedido da loja {order.loja?.nome}.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] pr-6">
          <div className="space-y-6">
            
            {/* Informações Gerais */}
            <section>
                <h3 className="text-lg font-semibold mb-2">Informações Gerais</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <DetailItem label="Nº Pedido Loja" value={order.numeroLoja} />
                    <DetailItem label="Data do Pedido" value={formatDate(order.data)} />
                    <DetailItem label="Data da Saída" value={formatDate(order.dataSaida)} />
                    <DetailItem label="Data Prevista" value={formatDate(order.dataPrevista)} />
                    <DetailItem label="Status" value={<Badge>{order.situacao?.nome || 'N/A'}</Badge>} />
                    <DetailItem label="Vendedor" value={order.vendedor?.nome} />
                </div>
            </section>

            <Separator />

            {/* Cliente */}
            <section>
                <h3 className="text-lg font-semibold mb-2">Cliente</h3>
                <div className="grid grid-cols-2 gap-4">
                    <DetailItem label="Nome" value={order.contato?.nome} />
                    <DetailItem label="Documento" value={order.contato?.numeroDocumento} />
                    <DetailItem label="Tipo Pessoa" value={order.contato?.tipoPessoa} />
                </div>
            </section>

            <Separator />

            {/* Itens do Pedido */}
            <section>
              <h3 className="text-lg font-semibold mb-2">Itens do Pedido ({order.itens?.length || 0})</h3>
              <div className="space-y-2">
                {order.itens?.map((item, index) => (
                    <div key={item.produto.id || index} className="flex justify-between items-center p-2 bg-gray-50 rounded-md">
                        <div>
                            <p className="font-semibold">{item.descricao}</p>
                            <p className="text-xs text-gray-500">SKU: {item.codigo}</p>
                        </div>
                        <div className="text-right">
                            <p>{item.quantidade} x {formatCurrency(item.valor)}</p>
                            <p className="text-xs text-gray-500">Total: {formatCurrency(item.quantidade * item.valor)}</p>
                        </div>
                    </div>
                ))}
              </div>
            </section>

            <Separator />
            
            {/* Financeiro */}
            <section>
                <h3 className="text-lg font-semibold mb-2">Financeiro</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <DetailItem label="Total Produtos" value={formatCurrency(order.totalProdutos)} />
                    <DetailItem label="Outras Despesas" value={formatCurrency(order.outrasDespesas)} />
                    <DetailItem label="Desconto" value={`${formatCurrency(order.desconto?.valor)} (${order.desconto?.unidade})`} />
                    <DetailItem label="Frete" value={formatCurrency(order.transporte?.frete)} />
                    <DetailItem label="Total do Pedido" value={<span className="font-bold">{formatCurrency(order.total)}</span>} />
                </div>
                {order.parcelas && order.parcelas.length > 0 && (
                    <div className="mt-4">
                        <h4 className="font-semibold mb-2">Parcelas</h4>
                        {order.parcelas.map(p => (
                             <div key={p.id} className="text-sm flex justify-between p-2 bg-gray-50 rounded-md">
                                <span>Vencimento: {formatDate(p.dataVencimento)}</span>
                                <span>{formatCurrency(p.valor)}</span>
                             </div>
                        ))}
                    </div>
                )}
            </section>

            <Separator />

             {/* Transporte */}
            {order.transporte && (
                <section>
                    <h3 className="text-lg font-semibold mb-2">Transporte e Entrega</h3>
                    <div className="grid grid-cols-2 gap-4">
                       <DetailItem label="Frete por Conta" value={order.transporte.fretePorConta === 1 ? 'Destinatário' : 'Emitente'} />
                       <DetailItem label="Qtd. Volumes" value={order.transporte.quantidadeVolumes} />
                       <DetailItem label="Peso Bruto" value={`${order.transporte.pesoBruto || 0} kg`} />
                       <DetailItem label="Prazo de Entrega" value={`${order.transporte.prazoEntrega || 0} dias`} />
                    </div>
                    {order.transporte.etiqueta && (
                        <div className="mt-4 p-3 bg-gray-50 rounded-md">
                           <h4 className="font-semibold mb-1">Endereço de Entrega</h4>
                           <p className="text-sm">{order.transporte.etiqueta.nome}</p>
                           <p className="text-sm">{order.transporte.etiqueta.endereco}, {order.transporte.etiqueta.numero}</p>
                           <p className="text-sm">{order.transporte.etiqueta.bairro} - {order.transporte.etiqueta.municipio}/{order.transporte.etiqueta.uf}</p>
                           <p className="text-sm">CEP: {order.transporte.etiqueta.cep}</p>
                           {order.transporte.etiqueta.complemento && <p className="text-sm">Comp: {order.transporte.etiqueta.complemento}</p>}
                        </div>
                    )}
                     {order.transporte.volumes && order.transporte.volumes.length > 0 && (
                        <div className="mt-4">
                            <h4 className="font-semibold mb-1">Volumes</h4>
                            {order.transporte.volumes.map(vol => (
                                <DetailItem key={vol.id} label={vol.servico} value={vol.codigoRastreamento || 'Sem rastreio'} />
                            ))}
                        </div>
                    )}
                </section>
            )}

            <Separator />
            
            {/* Observações */}
            <section>
                <h3 className="text-lg font-semibold mb-2">Observações</h3>
                <DetailItem label="Observações do Pedido" value={<pre className="text-xs whitespace-pre-wrap font-sans">{order.observacoes}</pre>} />
                <DetailItem label="Observações Internas" value={<pre className="text-xs whitespace-pre-wrap font-sans">{order.observacoesInternas}</pre>} />
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
