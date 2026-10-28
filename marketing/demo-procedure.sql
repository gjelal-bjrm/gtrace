CREATE PROCEDURE dbo.usp_FacturationMensuelle
  @mois date,
  @tauxRemise decimal(4,2)
AS
BEGIN
  DECLARE @id int = 1, @nb int, @total decimal(14,2) = 0
  DECLARE @client nvarchar(60), @montant decimal(12,2), @remise decimal(4,2)

  CREATE TABLE #Factures (id int PRIMARY KEY, client nvarchar(60), montant decimal(12,2), statut varchar(10))
  INSERT INTO #Factures VALUES (1, N'Atelier Durand', 1840.00, 'ouverte'), (2, N'Boulangerie Moreau', 320.50, 'ouverte'),
                               (3, N'Clinique du Lac', 12650.00, 'ouverte'), (4, N'Garage Petit', 975.25, 'ouverte')
  SELECT @nb = COUNT(*) FROM #Factures

  WHILE @id <= @nb
  BEGIN
    SELECT @client = client, @montant = montant FROM #Factures WHERE id = @id
    SET @remise = CASE WHEN @montant > 10000 THEN @tauxRemise ELSE 0 END
    UPDATE #Factures SET montant = montant * (1 - @remise), statut = 'calculée' WHERE id = @id
    SET @total = @total + @montant * (1 - @remise)
    SET @id = @id + 1
  END

  SELECT client, montant, statut FROM #Factures ORDER BY montant DESC
  SELECT @mois AS mois, @total AS total_facture
END
