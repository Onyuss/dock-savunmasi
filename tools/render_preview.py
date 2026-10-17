# Bir GLB modelinin önizleme görüntüsünü alır (tasarımı kontrol etmek için).
#   blender -b --factory-startup -P tools/render_preview.py -- model.glb cikti.png [mesafe] [yükseklik]
import bpy
import math
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
dist = float(argv[2]) if len(argv) > 2 else 11
height = float(argv[3]) if len(argv) > 3 else 3.5

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 48
sc.cycles.device = 'CPU'
sc.render.resolution_x, sc.render.resolution_y = 1100, 900
sc.view_settings.view_transform = 'AgX'

# Zemin, ışıklar, kamera (önden, sağdan 3/4 görünüm; oyunda ileri = Blender +Y)
bpy.ops.mesh.primitive_plane_add(size=60)
fl = bpy.context.active_object
m = bpy.data.materials.new('floor')
m.use_nodes = True
m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.05, 0.06, 0.055, 1)
fl.data.materials.append(m)
w = bpy.data.worlds.new('w')
sc.world = w
w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.03, 0.025, 1)
w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
for loc, power, col in (((6, 8, 9), 2500, (1, 0.97, 0.92)), ((-7, 3, 5), 900, (0.6, 0.8, 1.0)), ((0, -8, 6), 1200, (1, 0.8, 0.6))):
    l = bpy.data.lights.new('l', 'AREA')
    l.energy = power
    l.size = 4
    l.color = col
    o = bpy.data.objects.new('l', l)
    sc.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector((0, 0, 3)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
cam = bpy.data.cameras.new('c')
cam.lens = 45
co = bpy.data.objects.new('c', cam)
sc.collection.objects.link(co)
a = math.radians(30)
co.location = (math.sin(a) * dist, math.cos(a) * dist, height + 2)
target = Vector((0, 0, height))
co.rotation_euler = (target - co.location).to_track_quat('-Z', 'Y').to_euler()
sc.camera = co
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print('RENDERED', out)
