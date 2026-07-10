CREATE OR ALTER PROCEDURE ventes.TraiteCommandesEnAttente
  @DateLimite     datetime2,
  @SegmentFiltre  char(1)       = NULL,
  @ModeSimulation bit           = 1,
  @PlafondRemise  decimal(5,4)  = 0.25,
  @NbTraitees     int           OUTPUT,
  @MontantGlobal  decimal(18,2) OUTPUT
AS
BEGIN
  -- ==========================================================================
  -- Traite les commandes en attente antérieures à @DateLimite :
  --   * calcule le montant de chaque commande (remises par segment/volume),
  --   * journalise, met à jour le statut (sauf @ModeSimulation = 1),
  --   * agrège des statistiques par segment (MERGE),
  --   * collecte les erreurs par commande sans interrompre le lot.
  -- Codes retour : 0 = OK, 1 = terminé avec erreurs, 10/11 = paramètre invalide.
  -- ==========================================================================
  SET NOCOUNT ON;
  SET XACT_ABORT OFF;

  -- ==========================================================================
  -- Déclarations
  -- ==========================================================================
  DECLARE @CommandeId      int;
  DECLARE @ClientId        int;
  DECLARE @Segment         char(1);
  DECLARE @SoldeCompte     decimal(18,2);
  DECLARE @MontantCommande decimal(18,2);
  DECLARE @NbLignes        int;
  DECLARE @LigneCourante   int;
  DECLARE @Quantite        int;
  DECLARE @PrixUnitaire    decimal(18,2);
  DECLARE @RemiseLigne     decimal(5,4);
  DECLARE @MontantLigne    decimal(18,2);
  DECLARE @NbErreurs       int = 0;
  DECLARE @MsgErreur       nvarchar(400);
  DECLARE @SqlFiltre       nvarchar(max);
  DECLARE @NbCandidates    int;

  DECLARE @Erreurs TABLE (
    CommandeId int           NOT NULL,
    Message    nvarchar(400) NOT NULL
  );

  SET @NbTraitees    = 0;
  SET @MontantGlobal = 0;

  -- ==========================================================================
  -- Validations d'entrée
  -- ==========================================================================
  IF @DateLimite IS NULL
  BEGIN
    RAISERROR('Paramètre @DateLimite obligatoire.', 16, 1);
    RETURN 10;
  END

  -- Une date future n'a pas de sens : on la ramène à maintenant.
  IF @DateLimite > SYSDATETIME()
    SET @DateLimite = SYSDATETIME();

  IF @SegmentFiltre IS NOT NULL AND @SegmentFiltre NOT IN ('A', 'B', 'C')
  BEGIN
    RAISERROR('Segment inconnu : %s', 16, 1, @SegmentFiltre);
    RETURN 11;
  END

  IF @PlafondRemise < 0 OR @PlafondRemise > 0.9
    SET @PlafondRemise = 0.25;

  -- ==========================================================================
  -- Sélection des commandes candidates (SQL dynamique : filtre optionnel)
  -- ==========================================================================
  CREATE TABLE #Candidates (
    CommandeId int     NOT NULL PRIMARY KEY,
    ClientId   int     NOT NULL,
    Segment    char(1) NOT NULL,
    NbLignes   int     NOT NULL
  );

  SET @SqlFiltre = N'
    INSERT INTO #Candidates (CommandeId, ClientId, Segment, NbLignes)
    SELECT c.CommandeId, c.ClientId, cl.Segment, COUNT(l.LigneId)
    FROM ventes.Commande c
    JOIN ventes.Client cl ON cl.ClientId = c.ClientId
    JOIN ventes.LigneCommande l ON l.CommandeId = c.CommandeId
    WHERE c.Statut = N''EnAttente''
      AND c.DateCommande <= @p_DateLimite
      AND cl.Actif = 1';

  IF @SegmentFiltre IS NOT NULL
    SET @SqlFiltre = @SqlFiltre + N'
      AND cl.Segment = @p_Segment';

  SET @SqlFiltre = @SqlFiltre + N'
    GROUP BY c.CommandeId, c.ClientId, cl.Segment';

  EXEC sp_executesql
    @SqlFiltre,
    N'@p_DateLimite datetime2, @p_Segment char(1)',
    @p_DateLimite = @DateLimite,
    @p_Segment    = @SegmentFiltre;

  SET @NbCandidates = (SELECT COUNT(*) FROM #Candidates);

  IF @NbCandidates = 0
  BEGIN
    SELECT N'Aucune commande à traiter' AS Info;
    GOTO Nettoyage;
  END

  -- ==========================================================================
  -- Boucle principale : une commande à la fois
  -- ==========================================================================
  DECLARE curCommandes CURSOR LOCAL FAST_FORWARD FOR
    SELECT CommandeId, ClientId, Segment, NbLignes
    FROM #Candidates
    ORDER BY CommandeId;

  OPEN curCommandes;

  FETCH NEXT FROM curCommandes INTO @CommandeId, @ClientId, @Segment, @NbLignes;

  WHILE @@FETCH_STATUS = 0
  BEGIN
    SET @MontantCommande = 0;
    SET @LigneCourante   = 0;

    BEGIN TRY
      BEGIN TRANSACTION;
      SAVE TRANSACTION AvantCommande;

      SELECT @SoldeCompte = SoldeCompte
      FROM ventes.Client
      WHERE ClientId = @ClientId;

      -- ----------------------------------------------------------------------
      -- Boucle interne : lignes de la commande, par rang
      -- ----------------------------------------------------------------------
      WHILE @LigneCourante < @NbLignes
      BEGIN
        SET @LigneCourante = @LigneCourante + 1;

        SELECT @Quantite     = t.Quantite,
               @PrixUnitaire = t.PrixUnitaire,
               @RemiseLigne  = ISNULL(t.Remise, 0)
        FROM (
          SELECT Quantite, PrixUnitaire, Remise,
                 ROW_NUMBER() OVER (ORDER BY LigneId) AS Rang
          FROM ventes.LigneCommande
          WHERE CommandeId = @CommandeId
        ) t
        WHERE t.Rang = @LigneCourante;

        IF @Quantite IS NULL OR @Quantite <= 0
        BEGIN
          SET @MsgErreur = N'Quantité invalide (ligne '
                         + CAST(@LigneCourante AS nvarchar(10)) + N')';
          RAISERROR(@MsgErreur, 16, 1);
        END

        -- Remise commerciale : grille par segment puis par volume
        SET @RemiseLigne = @RemiseLigne +
          CASE @Segment
            WHEN 'A' THEN
              CASE
                WHEN @Quantite >= 10 THEN 0.10
                WHEN @Quantite >= 5  THEN 0.05
                ELSE 0.02
              END
            WHEN 'B' THEN
              CASE
                WHEN @Quantite >= 20 THEN 0.08
                ELSE 0.01
              END
            ELSE 0
          END;

        IF @RemiseLigne > @PlafondRemise
          SET @RemiseLigne = @PlafondRemise;

        SET @MontantLigne = @Quantite * @PrixUnitaire * (1 - @RemiseLigne);

        IF @MontantLigne < 0
        BEGIN
          SET @MsgErreur = N'Montant négatif calculé';
          RAISERROR(@MsgErreur, 16, 1);
        END

        SET @MontantCommande = @MontantCommande + @MontantLigne;
      END

      -- ----------------------------------------------------------------------
      -- Ajustements client : solde débiteur majoré, gros solde bonifié
      -- ----------------------------------------------------------------------
      IF @SoldeCompte < 0
      BEGIN
        SET @MontantCommande = @MontantCommande * 1.02;
        INSERT INTO ventes.JournalTraitement (CommandeId, Message)
        VALUES (@CommandeId, N'Majoration 2% (solde débiteur)');
      END
      ELSE
      BEGIN
        IF @SoldeCompte > 1000
          SET @MontantCommande = @MontantCommande * 0.99;
      END

      -- ----------------------------------------------------------------------
      -- Application : réelle ou simulation
      -- ----------------------------------------------------------------------
      IF @ModeSimulation = 0
      BEGIN
        UPDATE ventes.Commande
        SET Statut = N'Traitee', MontantTotal = @MontantCommande
        WHERE CommandeId = @CommandeId;

        IF @@ROWCOUNT <> 1
        BEGIN
          SET @MsgErreur = N'Commande disparue pendant le traitement';
          RAISERROR(@MsgErreur, 16, 1);
        END

        COMMIT TRANSACTION;
      END
      ELSE
      BEGIN
        -- Simulation : on annule les écritures, on garde les compteurs.
        ROLLBACK TRANSACTION AvantCommande;
        COMMIT TRANSACTION;
      END

      SET @NbTraitees    = @NbTraitees + 1;
      SET @MontantGlobal = @MontantGlobal + @MontantCommande;

      INSERT INTO ventes.JournalTraitement (CommandeId, Message)
      VALUES (@CommandeId, N'Commande traitée : '
                         + CAST(@MontantCommande AS nvarchar(30)));
    END TRY
    BEGIN CATCH
      SET @NbErreurs = @NbErreurs + 1;
      SET @MsgErreur = ERROR_MESSAGE();

      -- La transaction peut être active (erreur métier) ou condamnée.
      IF XACT_STATE() = 1
      BEGIN
        ROLLBACK TRANSACTION AvantCommande;
        COMMIT TRANSACTION;
      END
      ELSE
      BEGIN
        IF XACT_STATE() = -1
          ROLLBACK TRANSACTION;
      END

      INSERT INTO @Erreurs (CommandeId, Message)
      VALUES (@CommandeId, @MsgErreur);
    END CATCH

    FETCH NEXT FROM curCommandes INTO @CommandeId, @ClientId, @Segment, @NbLignes;
  END

  CLOSE curCommandes;
  DEALLOCATE curCommandes;

  -- ==========================================================================
  -- Statistiques par segment (MERGE dans la table de récap)
  -- ==========================================================================
  MERGE ventes.RecapSegment AS cible
  USING (
    SELECT Segment, COUNT(*) AS NbCommandes, SUM(NbLignes) AS TotalLignes
    FROM #Candidates
    GROUP BY Segment
  ) AS source
  ON cible.Segment = source.Segment
  WHEN MATCHED THEN
    UPDATE SET NbCommandes = source.NbCommandes,
               TotalLignes = source.TotalLignes,
               MisAJourLe  = SYSDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (Segment, NbCommandes, TotalLignes, MisAJourLe)
    VALUES (source.Segment, source.NbCommandes, source.TotalLignes, SYSDATETIME());

  -- ==========================================================================
  -- Restitution
  -- ==========================================================================
  SELECT
    @NbCandidates  AS NbCandidates,
    @NbTraitees    AS NbTraitees,
    @NbErreurs     AS NbErreurs,
    @MontantGlobal AS MontantGlobal;

  SELECT e.CommandeId, e.Message
  FROM @Erreurs e
  ORDER BY e.CommandeId;

  SELECT TOP (20) j.CommandeId, j.Message, j.CreeLe
  FROM ventes.JournalTraitement j
  ORDER BY j.LogId DESC;

  -- ==========================================================================
  -- Sortie
  -- ==========================================================================
Nettoyage:
  IF OBJECT_ID('tempdb..#Candidates') IS NOT NULL
    DROP TABLE #Candidates;

  IF CURSOR_STATUS('local', 'curCommandes') >= 0
  BEGIN
    CLOSE curCommandes;
    DEALLOCATE curCommandes;
  END

  IF @NbErreurs > 0
    RETURN 1;

  RETURN 0;
END
