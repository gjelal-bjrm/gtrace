using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace GTrace.Parser;

/// <summary>
/// Chiffrement DPAPI (CurrentUser) pour le canal MCP : le store de connexions
/// exposées à l'IA chiffre les mots de passe via ces méthodes. Indépendant de
/// safeStorage d'Electron (format « v10 » Chromium, non déchiffrable hors process).
/// Windows uniquement — l'entropie fixe lie les blobs à l'usage GTrace.
/// </summary>
public static class Dpapi
{
    private static readonly byte[] Entropy = "GTrace.Mcp.v1"u8.ToArray();

    public static object Protect(JsonElement parameters)
    {
        var plain = parameters.GetProperty("plaintext").GetString() ?? string.Empty;
        var bytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(plain), Entropy, DataProtectionScope.CurrentUser);
        return new { ciphertext = Convert.ToBase64String(bytes) };
    }

    public static object Unprotect(JsonElement parameters)
    {
        var b64 = parameters.GetProperty("ciphertext").GetString() ?? string.Empty;
        var bytes = ProtectedData.Unprotect(Convert.FromBase64String(b64), Entropy, DataProtectionScope.CurrentUser);
        return new { plaintext = Encoding.UTF8.GetString(bytes) };
    }
}
