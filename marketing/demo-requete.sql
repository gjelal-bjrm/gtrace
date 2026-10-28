SELECT client, ville, montant
FROM (VALUES (N'Atelier Durand', N'Lyon', 1840.00),
             (N'Clinique du Lac', N'Annecy', 12650.00),
             (N'Garage Petit', N'Nantes', 975.25),
             (N'Boulangerie Moreau', N'Lille', 320.50)) AS f(client, ville, montant)
ORDER BY montant DESC
