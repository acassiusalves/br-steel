# Índice do Firestore para Otimização

Para melhorar a performance da página de vendas, é necessário criar um índice composto no Firestore.

## Como criar o índice:

1. Acesse o [Console do Firebase](https://console.firebase.google.com/)
2. Selecione seu projeto
3. Vá em **Firestore Database** > **Indexes** (Índices)
4. Clique em **Create Index** (Criar Índice)
5. Configure o índice com os seguintes parâmetros:

   - **Collection ID**: `salesOrders`
   - **Fields to index**:
     - Campo 1: `data` - **Ascending** (Crescente)
     - Campo 2: `__name__` - **Ascending** (Crescente)
   - **Query scope**: Collection

6. Clique em **Create** e aguarde alguns minutos até o índice ser criado

## Alternativa (via CLI):

Se preferir criar via Firebase CLI, adicione esta configuração em `firestore.indexes.json`:

```json
{
  "indexes": [
    {
      "collectionGroup": "salesOrders",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "data",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "__name__",
          "order": "ASCENDING"
        }
      ]
    }
  ]
}
```

Depois execute:
```bash
firebase deploy --only firestore:indexes
```

## Por que este índice é importante?

O índice permite que o Firestore execute queries com filtros de range (`>=` e `<=`) no campo `data` de forma muito mais eficiente, reduzindo drasticamente o tempo de carregamento do dashboard.
