using System.Text;
using System.Text.Json;
using GTrace.Parser;
using GTrace.Parser.Instrumentation;
using GTrace.Parser.Parsing;

// Protocole JSON ligne par ligne sur stdin/stdout.
// Requête :  { "id": 1, "method": "parse", "params": { "sql": "...", "compatLevel": 150 } }
// Réponse :  { "id": 1, "result": { ... } } | { "id": 1, "error": { "code": ..., "message": "..." } }

Console.OutputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);

// L'ENTRÉE doit être lue en UTF-8 explicitement : Console.ReadLine() décode
// sinon avec la page de codes de la console (CP850 sous Windows), ce qui
// corrompt tout caractère non-ASCII. Un identifiant comme [N°Client] arrivait
// en [NÂ°Client] et SQL Server répondait « Invalid column name ».
var stdin = new StreamReader(
    Console.OpenStandardInput(),
    new UTF8Encoding(encoderShouldEmitUTF8Identifier: false)
);

var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase
};

string? line;
while ((line = stdin.ReadLine()) != null)
{
    line = line.TrimStart('\uFEFF'); // BOM éventuel injecté par certains shells
    if (string.IsNullOrWhiteSpace(line)) continue;

    long id = 0;
    object response;
    try
    {
        using var doc = JsonDocument.Parse(line);
        var root = doc.RootElement;
        id = root.GetProperty("id").GetInt64();
        var method = root.GetProperty("method").GetString();

        response = method switch
        {
            "ping" => new
            {
                id,
                result = new
                {
                    ok = true,
                    version = ParseHandler.ScriptDomVersion
                }
            },
            "parse" => new { id, result = ParseHandler.Handle(root.GetProperty("params")) },
            "instrument" => new { id, result = Instrumenter.Handle(root.GetProperty("params")) },
            "validate" => new { id, result = Validator.Handle(root.GetProperty("params")) },
            "validateReadOnly" => new { id, result = ReadOnlyValidator.Handle(root.GetProperty("params")) },
            "dpapiProtect" => new { id, result = Dpapi.Protect(root.GetProperty("params")) },
            "dpapiUnprotect" => new { id, result = Dpapi.Unprotect(root.GetProperty("params")) },
            _ => new { id, error = new { code = -32601, message = $"Méthode inconnue '{method}'" } }
        };
    }
    catch (Exception ex)
    {
        response = new { id, error = new { code = -32000, message = ex.Message } };
    }

    Console.WriteLine(JsonSerializer.Serialize(response, jsonOptions));
}
