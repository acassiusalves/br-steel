"use client";

import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import * as React from "react";
import { BrainCircuit, Loader2 } from "lucide-react";

import type { PredictSalesTrendsInput, PredictSalesTrendsOutput } from "@/ai/flows/predict-sales-trends";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { getSalesPrediction } from "@/app/actions";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "./ui/skeleton";

const FormSchema = z.object({
  historicalSalesData: z.string().min(50, {
    message: "Por favor, insira dados históricos de vendas com pelo menos 50 caracteres.",
  }),
});

export default function PredictiveAnalysis() {
  const [prediction, setPrediction] = React.useState<PredictSalesTrendsOutput | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
        historicalSalesData: "",
    },
  });

  const onSubmit: SubmitHandler<PredictSalesTrendsInput> = async (data) => {
    setIsLoading(true);
    setPrediction(null);
    try {
      const result = await getSalesPrediction(data);
      setPrediction(result);
    } catch (error) {
      console.error("Prediction error:", error);
      toast({
        variant: "destructive",
        title: "Erro na Análise",
        description: "Não foi possível gerar a previsão. Tente novamente mais tarde.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
       <Card>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardHeader>
              <CardTitle>Análise Preditiva de Vendas</CardTitle>
              <CardDescription>
                Use IA para prever tendências de vendas com base em dados históricos. Cole seus dados no formato CSV ou similar.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="historicalSalesData"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dados Históricos de Vendas</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Cole aqui os dados de vendas. Ex: data,produto,quantidade,preco,marketplace..."
                        className="min-h-[150px] resize-y"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Inclua colunas como data, produto, quantidade, preço e marketplace.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Analisando...
                  </>
                ) : (
                  <>
                    <BrainCircuit className="mr-2 h-4 w-4" />
                    Analisar Tendências
                  </>
                )}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>

      {isLoading && (
         <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-3">
            <CardHeader>
              <Skeleton className="h-6 w-1/4" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
               <Skeleton className="h-6 w-1/3" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
               <Skeleton className="h-6 w-1/4" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-4 w-full" />
               <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </CardContent>
          </Card>
        </div>
      )}

      {prediction && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Resumo da Análise</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">{prediction.summary}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Fatores Chave</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">{prediction.keyFactors}</p>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Recomendações</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">{prediction.recommendations}</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
