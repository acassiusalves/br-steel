
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
        <div className="text-sm text-gray-900">{value || 'N/A'}</div>
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
        <div className="mt-4">
            <Tabs defaultValue="geral">
                <TabsList className="grid w-full grid-cols-3 sm:grid-cols-6">
                    <TabsTrigger value="geral">Geral</TabsTrigger>
                    <TabsTrigger value="cliente">Cliente</TabsTrigger>
                    <TabsTrigger value="itens">Itens</TabsTrigger>
                    <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
                    <TabsTrigger value="transporte">Transporte</TabsTrigger>
                    <TabsTrigger value="obs">Observações</TabsTrigger>
                </TabsList>

                <ScrollArea className="h-[55vh] mt-4">
                  <div className="pr-4 space-y-6">
                    <TabsContent value="geral">
                       <Card className="border-none shadow-none">
                            <CardHeader>
                                <CardTitle className="text-lg">Informações Gerais</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    <DetailItem label="Nº Pedido Loja" value={order.numeroLoja} />
                                    <DetailItem label="Data do Pedido" value={formatDate(order.data)} />
                                    <DetailItem label="Data da Saída" value={formatDate(order.dataSaida)} />
                                    <DetailItem label="Data Prevista" value={formatDate(order.dataPrevista)} />
                                    <DetailItem label="Status" value={<Badge>{order.situacao?.nome || 'N/A'}</Badge>} />
                                    <DetailItem label="Vendedor" value={order.vendedor?.nome} />
                                    <DetailItem label="ID Nota Fiscal" value={order.notaFiscal?.id} />
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="cliente">
                         <Card className="border-none shadow-none">
                            <CardHeader>
                                <CardTitle className="text-lg">Cliente</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <DetailItem label="Nome" value={order.contato?.nome} />
                                    <DetailItem label="Documento" value={order.contato?.numeroDocumento} />
                                    <DetailItem label="Tipo Pessoa" value={order.contato?.tipoPessoa} />
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="itens">
                        <Card className="border-none shadow-none">
                            <CardHeader>
                                <CardTitle className="text-lg">Itens do Pedido ({order.itens?.length || 0})</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
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
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="financeiro">
                         <Card className="border-none shadow-none">
                            <CardHeader>
                                <CardTitle className="text-lg">Financeiro</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    <DetailItem label="Total Produtos" value={formatCurrency(order.totalProdutos)} />
                                    <DetailItem label="Frete Pago pelo Cliente" value={formatCurrency(order.transporte?.frete)} />
                                    <DetailItem label="Desconto" value={`${formatCurrency(order.desconto?.valor)} (${order.desconto?.unidade})`} />
                                    <DetailItem label="Outras Despesas" value={formatCurrency(order.outrasDespesas)} />
                                    <DetailItem label="Total do Pedido" value={<span className="font-bold">{formatCurrency(order.total)}</span>} />
                                </div>
                                <Separator />
                                <div>
                                     <h4 className="font-semibold mb-2 text-base">Custos da Venda</h4>
                                     <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                        <DetailItem label="Custo do Frete" value={formatCurrency(order.taxas?.custoFrete)} />
                                        <DetailItem label="Taxa de Comissão" value={formatCurrency(order.taxas?.taxaComissao)} />
                                        <DetailItem label="Total IPI" value={formatCurrency(order.tributacao?.totalIPI)} />
                                        <DetailItem label="Total ICMS" value={formatCurrency(order.tributacao?.totalICMS)} />
                                     </div>
                                </div>
                                {order.parcelas && order.parcelas.length > 0 && (
                                    <div>
                                        <Separator className="my-4" />
                                        <h4 className="font-semibold mb-2">Parcelas</h4>
                                        <div className="space-y-2">
                                            {order.parcelas.map(p => (
                                                 <div key={p.id} className="text-sm flex justify-between p-2 bg-gray-50 rounded-md">
                                                    <span>Vencimento: {formatDate(p.dataVencimento)}</span>
                                                    <span>{formatCurrency(p.valor)}</span>
                                                 </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="transporte">
                        {order.transporte && (
                             <Card className="border-none shadow-none">
                                <CardHeader>
                                    <CardTitle className="text-lg">Transporte e Entrega</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
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
                                </CardContent>
                             </Card>
                         )}
                    </TabsContent>
                    
                    <TabsContent value="obs">
                        <Card className="border-none shadow-none">
                            <CardHeader>
                                <CardTitle className="text-lg">Observações</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <DetailItem label="Observações do Pedido" value={<pre className="text-xs whitespace-pre-wrap font-sans">{order.observacoes}</pre>} />
                                <DetailItem label="Observações Internas" value={<pre className="text-xs whitespace-pre-wrap font-sans">{order.observacoesInternas}</pre>} />
                            </CardContent>
                        </Card>
                    </TabsContent>
                    </div>
                </ScrollArea>
            </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
