# Regras e índices do Firestore

O [firebase.json](../firebase.json) referencia as [regras](../firestore.rules) e os [índices](../firestore.indexes.json) versionados. Inclua o diff correspondente quando uma mudança exigir regra ou índice novo.

Valide as regras com o emulador do [guia de desenvolvimento local](desenvolvimento-local.md). A configuração de testes carrega as regras. Revise os índices declarados e confirme a disponibilidade deles no ambiente de destino quando a alteração depender de consultas compostas.

Para uma publicação autorizada, confira a conta autenticada, o ID do projeto e a ordem de entrega entre os consumidores e as regras. Informe sempre o ID explícito, pois o [arquivo de aliases](../.firebaserc) tem um projeto padrão. Exemplo para uma publicação apenas de índices, após substituir o ID:

```sh
firebase deploy --only firestore:indexes --project ID_DO_PROJETO_AUTORIZADO
```

Depois da publicação, confira o estado dos índices no console do projeto selecionado antes de verificar as consultas que dependem deles.
