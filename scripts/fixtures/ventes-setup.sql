-- Schéma de test « ventes » pour le test de charge GTrace (idempotent).
IF OBJECT_ID('ventes.TraiteCommandesEnAttente', 'P') IS NOT NULL DROP PROCEDURE ventes.TraiteCommandesEnAttente;
IF OBJECT_ID('ventes.JournalTraitement', 'U') IS NOT NULL DROP TABLE ventes.JournalTraitement;
IF OBJECT_ID('ventes.RecapSegment', 'U') IS NOT NULL DROP TABLE ventes.RecapSegment;
IF OBJECT_ID('ventes.LigneCommande', 'U') IS NOT NULL DROP TABLE ventes.LigneCommande;
IF OBJECT_ID('ventes.Commande', 'U') IS NOT NULL DROP TABLE ventes.Commande;
IF OBJECT_ID('ventes.Client', 'U') IS NOT NULL DROP TABLE ventes.Client;
IF SCHEMA_ID('ventes') IS NULL EXEC('CREATE SCHEMA ventes');
GO

CREATE TABLE ventes.Client (
  ClientId    int           NOT NULL PRIMARY KEY,
  Nom         nvarchar(100) NOT NULL,
  Segment     char(1)       NOT NULL,
  Actif       bit           NOT NULL,
  SoldeCompte decimal(18,2) NOT NULL
);

CREATE TABLE ventes.Commande (
  CommandeId   int           NOT NULL PRIMARY KEY,
  ClientId     int           NOT NULL REFERENCES ventes.Client (ClientId),
  DateCommande datetime2     NOT NULL,
  Statut       nvarchar(20)  NOT NULL,
  MontantTotal decimal(18,2) NULL
);

CREATE TABLE ventes.LigneCommande (
  LigneId      int           NOT NULL PRIMARY KEY,
  CommandeId   int           NOT NULL REFERENCES ventes.Commande (CommandeId),
  Produit      nvarchar(50)  NOT NULL,
  Quantite     int           NOT NULL,
  PrixUnitaire decimal(18,2) NOT NULL,
  Remise       decimal(5,4)  NULL
);

CREATE TABLE ventes.JournalTraitement (
  LogId      int           NOT NULL IDENTITY PRIMARY KEY,
  CommandeId int           NOT NULL,
  Message    nvarchar(400) NOT NULL,
  CreeLe     datetime2     NOT NULL DEFAULT SYSDATETIME()
);

CREATE TABLE ventes.RecapSegment (
  Segment     char(1)       NOT NULL PRIMARY KEY,
  NbCommandes int           NOT NULL,
  TotalLignes int           NOT NULL,
  MisAJourLe  datetime2     NOT NULL
);
GO

INSERT INTO ventes.Client (ClientId, Nom, Segment, Actif, SoldeCompte) VALUES
  (1, N'Alpha SARL',      'A', 1,  1500.00),
  (2, N'Beta & Cie',      'B', 1,  -200.00),
  (3, N'Gamma SA',        'C', 1,    50.00),
  (4, N'Delta (inactif)', 'A', 0,     0.00);

INSERT INTO ventes.Commande (CommandeId, ClientId, DateCommande, Statut, MontantTotal) VALUES
  (1, 1, '2026-06-01', N'EnAttente', NULL),
  (2, 1, '2026-06-15', N'EnAttente', NULL),
  (3, 2, '2026-06-10', N'EnAttente', NULL),
  (4, 2, '2026-06-20', N'EnAttente', NULL),  -- contient une ligne invalide (qty 0)
  (5, 3, '2026-06-05', N'EnAttente', NULL),
  (6, 3, '2026-06-25', N'EnAttente', NULL),
  (7, 4, '2026-06-12', N'EnAttente', NULL),  -- client inactif : exclue
  (8, 1, '2026-05-01', N'Traitee',   999.99); -- déjà traitée : exclue

INSERT INTO ventes.LigneCommande (LigneId, CommandeId, Produit, Quantite, PrixUnitaire, Remise) VALUES
  (101, 1, N'Boulon M8',     12, 2.50, NULL),
  (102, 1, N'Écrou M8',       6, 1.20, 0.02),
  (103, 1, N'Rondelle',       2, 0.30, NULL),
  (201, 2, N'Vis TF 4x40',    5, 3.10, NULL),
  (202, 2, N'Cheville 6mm',   1, 0.80, NULL),
  (301, 3, N'Câble 3G1.5',   25, 1.90, 0.05),
  (302, 3, N'Gaine ICTA',     2, 0.70, NULL),
  (303, 3, N'Boîte encastr.', 8, 1.10, NULL),
  (401, 4, N'Produit KO',     0, 9.99, NULL),  -- quantité invalide → CATCH
  (501, 5, N'Peinture 10L',   4, 32.00, NULL),
  (502, 5, N'Rouleau',        7, 4.50, 0.10),
  (503, 5, N'Bâche',          1, 6.00, NULL),
  (504, 5, N'Ruban masquage', 3, 2.20, NULL),
  (601, 6, N'Colle PVC',      2, 5.40, NULL),
  (602, 6, N'Tube PVC 32',   11, 3.80, NULL),
  (701, 7, N'Ne compte pas',  1, 1.00, NULL);
GO
